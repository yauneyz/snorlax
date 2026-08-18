package app.talysman.insights

import android.app.Application
import app.talysman.insights.notifications.PushNotifications

class TalysmanInsightsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PushNotifications.createChannels(this)
        PushNotifications.initializeFirebase(this)
    }
}
