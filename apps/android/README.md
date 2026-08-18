# Talysman Insights Android app

Copy `local.properties.example` to `local.properties` and retain your Android SDK and insights API
values. Put the Firebase Android client downloaded from Firebase Console at
`../../local-credentials/talysman-insights-google-services.json`; the Gradle build reads it
directly. If that file is unavailable, the optional `local.properties` fallback mappings are:

- `fcm.projectId`: `project_info.project_id`
- `fcm.senderId`: `project_info.project_number`
- `fcm.applicationId`: the `client_info.mobilesdk_app_id` for `app.talysman.insights`
- `fcm.apiKey`: that client's `api_key[0].current_key`

The app initializes Firebase directly, so the JSON remains in the gitignored credentials folder
instead of going into the Android source tree. On first launch Android 13+ asks for notification
permission and the app registers its FCM token with the bearer-protected web endpoint.

For the server, put a Firebase service-account JSON with Cloud Messaging send permission under
the already-gitignored `local-credentials/` directory and set, for example:

```toml
[insights]
widget_api_key = "your-existing-key"
fcm_service_account_file = "local-credentials/firebase-service-account.json"
```

Apply Supabase migration `0009_insights_push_devices.sql`, run `pnpm sync:env:prod`, and redeploy
the web app before installing the newly built APK.

Paid conversions use a separate high-priority notification channel. The build stages
`../../assets/zelda-secret.mp3` as the Android resource `conversion_unlocked.mp3`; if that source
asset is absent, the OS default notification sound is used. Android stores channel sound settings
after first creation, so reinstall the app (or delete the “Paid conversions” channel in system
settings) after changing the file. Users and some device policies can override or silence any
channel sound.
