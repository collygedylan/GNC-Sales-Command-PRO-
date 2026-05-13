# GNC ML Live Processing Setup

This setup keeps the app live while keeping secrets out of the PWA. The app inserts a row into `v2_ml_image_jobs` after a photo is uploaded. Supabase then wakes the GitHub Actions ML worker through the `ml-dispatch` Edge Function.

## 1. GitHub Secrets

In GitHub, open the repository, then go to **Settings > Secrets and variables > Actions > New repository secret**.

Add these secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GDRIVE_SERVICE_ACCOUNT_JSON`
- `GDRIVE_INVENTORY_FILE_ID`

The workflow also needs model files in `/models`. The Drive sync workflow should place `plant_classifier.pt`, `labels.json`, `diagnostics_classifier.pt`, and `diagnostics_labels.json` there when those files exist in the Drive model folder.

## 2. GitHub Dispatch Token

Create a fine-grained GitHub personal access token for this repository.

Required repository permission:

- **Contents: Read and write**

This token is only stored in Supabase Edge Function secrets, not in the app.

## 3. Deploy The Supabase Edge Function

Deploy `supabase/functions/ml-dispatch`.

Set these Edge Function secrets:

- `GITHUB_DISPATCH_TOKEN`: the GitHub token from step 2
- `GITHUB_REPOSITORY`: `collygedylan/GNC-Sales-Command-PRO-`
- `GITHUB_DISPATCH_EVENT`: `ml-photo-created`
- `ML_DISPATCH_SECRET`: a long random secret you create

The same `ML_DISPATCH_SECRET` is used in `ml_live_dispatch_setup.sql`.

## 4. Run SQL

Run these files in the Supabase SQL Editor in this order:

1. `ml_pipeline_migration.sql`
2. `ml_disease_training_assets_migration.sql`
3. `ml_live_dispatch_setup.sql`

Before running `ml_live_dispatch_setup.sql`, replace:

- `REPLACE_WITH_PROJECT_REF` with the Supabase project ref, for example `kzrnyjsosryejjejliii`
- `REPLACE_WITH_LONG_RANDOM_DISPATCH_SECRET` with the exact `ML_DISPATCH_SECRET` from step 3

## 5. Mirror Disease Drive Folders

The screenshots show folder names, but Apps Script needs the parent Drive folder ID.

Copy `disease_drive_sync_code.gs` into Apps Script and set Script Properties:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DISEASE_DRIVE_ROOT_FOLDER_ID`

Run `runDiseaseDriveToSupabaseSync()` once. It recreates the Drive folder paths inside the `disease_training_assets` Supabase bucket and upserts file metadata into `v2_disease_training_assets`.

## 6. How Live Processing Works

For app photos:

1. The app uploads the image to the proper Supabase bucket.
2. The app inserts a `pending_ml` row into `v2_ml_image_jobs`.
3. The database trigger calls the `ml-dispatch` Edge Function.
4. The Edge Function calls GitHub `repository_dispatch`.
5. GitHub Actions runs `supabase_ml_worker.py` once.
6. The worker updates the row to `pending_approval`.
7. Dylan sees diagnostic issue rows in **Tasks > Diagnostics**.

For disease training folders:

1. Apps Script mirrors Drive files to `disease_training_assets`.
2. Apps Script inserts or updates `v2_disease_training_assets` with `processed_status = 'pending_ml'`.
3. The same dispatch path wakes the worker.
4. The worker processes image assets with the diagnostics model when present and indexes lab reports as reference material.

GitHub-hosted Actions are near-live, usually seconds to a couple minutes. For truly instant processing under heavy photo volume, move the same worker to an always-on server or self-hosted GitHub runner.
