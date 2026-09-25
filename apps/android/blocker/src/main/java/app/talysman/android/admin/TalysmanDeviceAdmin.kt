package app.talysman.android.admin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Sideloaded builds (spec §6.2): as a device admin, Talysman can't be uninstalled until admin is
 * turned off — and the accessibility service guards that screen while blocking is on.
 */
class TalysmanDeviceAdmin : DeviceAdminReceiver() {
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
        "Talysman won’t be protected from being uninstalled."

    companion object {
        fun component(context: Context) = ComponentName(context, TalysmanDeviceAdmin::class.java)

        fun isActive(context: Context): Boolean =
            context.getSystemService(DevicePolicyManager::class.java)?.isAdminActive(component(context)) == true

        fun enableIntent(context: Context): Intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
            .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component(context))
            .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Stops Talysman being uninstalled while blocking is on.")
    }
}
