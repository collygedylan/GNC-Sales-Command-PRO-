# Google Cloud Setup for the GNC ML Pipeline

This guide creates the Google Cloud service account used by the GitHub Drive sync and the Python ML worker. The service account only needs access to the specific Google Drive model folder and inventory file that you share with it.

## 1. Create or Select a Google Cloud Project

1. Open the Google Cloud Console.
2. Select the organization/account that owns the Drive assets.
3. Create a new project named `gnc-ml-pipeline`, or select an existing project dedicated to the app.
4. Confirm the project selector at the top of the console shows the project you want to use.

## 2. Enable the Google Drive API

1. In the selected project, open **APIs & Services**.
2. Choose **Enable APIs and services**.
3. Search for **Google Drive API**.
4. Open the Google Drive API result and choose **Enable**.

## 3. Create the Service Account

1. Open **IAM & Admin > Service Accounts**.
2. Choose **Create service account**.
3. Use a clear name such as `gnc-drive-model-sync`.
4. Add a description such as `Reads GNC Drive model and inventory files for app ML automation`.
5. Choose **Create and continue**.
6. You do not need to grant project-wide roles for Drive file access. Choose **Done**.
7. Open the new service account and copy its email address. It will look like:

```text
gnc-drive-model-sync@your-project-id.iam.gserviceaccount.com
```

## 4. Generate the JSON Key

1. Open the service account details page.
2. Choose **Keys**.
3. Choose **Add key > Create new key**.
4. Select **JSON**.
5. Download the JSON file.
6. Store it securely. Do not commit this JSON file to GitHub.

## 5. Share the Drive Model Folder

1. Open Google Drive.
2. Find the folder that contains your ML model files.
3. Right-click the folder and choose **Share**.
4. Paste the service account email.
5. Give it **Viewer** access.
6. Send/share the permission.
7. Copy the folder ID from the folder URL. In a URL like:

```text
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
```

the folder ID is:

```text
1AbCdEfGhIjKlMnOpQrStUvWxYz
```

This value becomes the GitHub secret `GDRIVE_MODEL_FOLDER_ID`.

## 6. Share the Drive Inventory File

1. Open the Google Drive inventory file used by Drive Mode.
2. Choose **Share**.
3. Paste the same service account email.
4. Give it **Viewer** access.
5. Copy the file ID from the URL. In a URL like:

```text
https://docs.google.com/spreadsheets/d/1InventoryFileIdHere/edit
```

the file ID is:

```text
1InventoryFileIdHere
```

This value becomes the ML worker environment variable `GDRIVE_INVENTORY_FILE_ID`.

## 7. Add GitHub Actions Secrets

In the GitHub repository:

1. Open **Settings > Secrets and variables > Actions**.
2. Add a repository secret named `GDRIVE_SERVICE_ACCOUNT_JSON`.
3. Paste the full contents of the downloaded service account JSON file.
4. Add a repository secret named `GDRIVE_MODEL_FOLDER_ID`.
5. Paste the Google Drive model folder ID.

## 8. Add Worker Environment Values

On the server hub that runs the Docker Compose ML worker, create a `.env` file from `.env.example` and set:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GDRIVE_SERVICE_ACCOUNT_JSON=
GDRIVE_INVENTORY_FILE_ID=
ML_MODEL_PATH=/app/models/plant_classifier.pt
ML_LABELS_PATH=/app/models/labels.json
```

Use the Supabase service role key only on the server. Do not put the service role key in the PWA or in public client code.

## 9. Verify Access

Before turning on the worker:

1. Run the GitHub workflow manually with **Run workflow** and confirm model files appear under `/models`.
2. Start the worker with Docker Compose.
3. Confirm the worker can read the inventory file and logs the number of loaded inventory rows.
4. Upload one AI Capture photo from the PWA and confirm the row moves from `pending_ml` to `pending_approval`.
