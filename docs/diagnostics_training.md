# Diagnostics Model Training

The GNC diagnostics model is trained from the disease assets mirrored into Supabase by `Code.gs`.

## Source Data

The trainer reads `public.v2_disease_training_assets` and downloads files from the `disease_training_assets` storage bucket.

Visual training samples come from:

- Rows where `asset_kind = diagnostic_photo` and the file is an image.
- Embedded plant photos extracted from PDF lab reports, when the PDF contains embedded images.

PDFs that contain only report text are indexed as lab references, but they are not useful visual training samples by themselves.

## Outputs

The trainer writes these files into `/models`:

- `diagnostics_classifier.pt`
- `diagnostics_labels.json`
- `diagnostics_training_report.json`

The GitHub ML worker loads `diagnostics_classifier.pt` and `diagnostics_labels.json` when processing new app photos.

## GitHub Workflow

Use the `Train Diagnostics Model` workflow in GitHub Actions.

Recommended first run:

1. Open GitHub Actions.
2. Select `Train Diagnostics Model`.
3. Run with `dry_run = true`.
4. Confirm the report shows enough visual samples and labels.
5. Run again with `dry_run = false`.

If the dry run says there are no visual samples, add actual disease photos to the Drive disease folders or lab-report PDFs that contain embedded plant photos, run `runDiseaseDriveToSupabaseSync()`, then rerun the training workflow.

## Important

This training system does not invent confidence. If there are not enough visual samples, it writes a readiness report and does not create a fake model.
