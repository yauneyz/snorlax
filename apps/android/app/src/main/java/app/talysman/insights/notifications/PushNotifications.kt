package app.talysman.insights.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.talysman.insights.BuildConfig
import app.talysman.insights.MainActivity
import app.talysman.insights.R
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.atomic.AtomicInteger

object PushNotifications {
    private const val DOWNLOAD_CHANNEL = "downloads_v1"
    private const val CONVERSION_CHANNEL = "paid_conversions_v1"
    private const val ERROR_CHANNEL = "app_errors_v1"
    private const val CONVERSION_SOUND_RESOURCE = "conversion_unlocked"
    private val nextNotificationId = AtomicInteger(1000)

    fun initializeFirebase(context: Context): Boolean {
        if (
            BuildConfig.FCM_PROJECT_ID.isBlank() ||
            BuildConfig.FCM_APPLICATION_ID.isBlank() ||
            BuildConfig.FCM_API_KEY.isBlank() ||
            BuildConfig.FCM_SENDER_ID.isBlank()
        ) return false
        if (FirebaseApp.getApps(context).isNotEmpty()) return true

        val options = FirebaseOptions.Builder()
            .setProjectId(BuildConfig.FCM_PROJECT_ID)
            .setApplicationId(BuildConfig.FCM_APPLICATION_ID)
            .setApiKey(BuildConfig.FCM_API_KEY)
            .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
            .build()
        FirebaseApp.initializeApp(context, options)
        return true
    }

    fun registerCurrentToken(context: Context) {
        if (!initializeFirebase(context)) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            PushRegistrationWorker.enqueue(context, token)
        }
    }

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                DOWNLOAD_CHANNEL,
                "Downloads",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "A Talysman installer was downloaded"
            },
        )

        val soundId = context.resources.getIdentifier(
            CONVERSION_SOUND_RESOURCE,
            "raw",
            context.packageName,
        )
        val soundUri = if (soundId == 0) {
            Settings.System.DEFAULT_NOTIFICATION_URI
        } else {
            Uri.parse("android.resource://${context.packageName}/$soundId")
        }
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .build()
        manager.createNotificationChannel(
            NotificationChannel(
                CONVERSION_CHANNEL,
                "Paid conversions",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Celebrates a new paid Talysman customer"
                setSound(soundUri, audioAttributes)
                enableVibration(true)
            },
        )

        manager.createNotificationChannel(
            NotificationChannel(
                ERROR_CHANNEL,
                "App errors",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "An install-blocking error was reported by a real user"
                enableVibration(true)
            },
        )
    }

    fun show(context: Context, data: Map<String, String>) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) return

        val conversion = data["type"] == "paid_conversion"
        val isError = data["type"] == "app_error"
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (isError) putExtra(MainActivity.EXTRA_OPEN_ERRORS, true)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val channel = when {
            isError -> ERROR_CHANNEL
            conversion -> CONVERSION_CHANNEL
            else -> DOWNLOAD_CHANNEL
        }
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(data["title"] ?: if (conversion) "A new paid user! 🎉" else "New download")
            .setContentText(data["body"] ?: "Talysman has a new event.")
            .setStyle(NotificationCompat.BigTextStyle().bigText(data["body"]))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(
                if (conversion || isError) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT,
            )
            .build()

        NotificationManagerCompat.from(context)
            .notify(nextNotificationId.incrementAndGet(), notification)
    }
}
