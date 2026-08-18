package app.talysman.insights.notifications

import app.talysman.insights.work.RefreshScheduler
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class InsightsMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushRegistrationWorker.enqueue(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        PushNotifications.show(this, message.data)
        RefreshScheduler.refreshNow(this)
    }
}
