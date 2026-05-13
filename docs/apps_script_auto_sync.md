# Apps Script Code.gs Auto Sync

This repository syncs `Code.gs` into the Google Apps Script project with the GitHub Actions workflow:

`.github/workflows/apps-script-sync.yml`

The workflow runs automatically when `Code.gs` changes on `main`, and it can also be run manually from GitHub Actions.

## What It Does

- Fetches the existing Apps Script project content.
- Replaces only the Apps Script file named `Code`.
- Preserves every other Apps Script file in the project.
- Optionally creates a new Apps Script version and advances an existing web app deployment.

## Required GitHub Secrets

Add these under GitHub repository settings:

`Settings > Secrets and variables > Actions > New repository secret`

### APPS_SCRIPT_SCRIPT_ID

The Apps Script project ID.

Find it in Apps Script:

`Project Settings > Script ID`

### APPS_SCRIPT_CLASPRC_JSON

The OAuth credentials JSON used by clasp.

On a trusted computer where you are logged into the correct Google account:

```bash
npm install -g @google/clasp
clasp login
```

Then copy the contents of:

```bash
~/.clasprc.json
```

Paste the full JSON as the `APPS_SCRIPT_CLASPRC_JSON` GitHub secret.

The Google account used here must have edit access to the Apps Script project.

## Optional GitHub Secret

### APPS_SCRIPT_DEPLOYMENT_ID

Add this if you want the live `/exec` web app deployment to update automatically after each sync.

Find it in Apps Script:

`Deploy > Manage deployments > select the web app deployment > Deployment ID`

If this secret is not set, the workflow still updates the Apps Script project code, but you will need to manually create a new deployment version in Apps Script before the live `/exec` URL uses the new code.

## Google API Requirements

The Apps Script API must be enabled for the Google account/project used by clasp.

In Apps Script:

`Project Settings > Google Cloud Platform (GCP) Project`

Then in Google Cloud Console, enable:

- Google Apps Script API

## Manual Run

After adding the secrets:

1. Open GitHub.
2. Go to `Actions`.
3. Select `Sync Code.gs to Apps Script`.
4. Click `Run workflow`.

If the workflow succeeds and `APPS_SCRIPT_DEPLOYMENT_ID` is set, the existing Apps Script web app deployment is advanced automatically.
