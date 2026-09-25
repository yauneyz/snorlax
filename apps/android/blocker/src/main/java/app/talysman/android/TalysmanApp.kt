package app.talysman.android

import android.app.Application
import app.talysman.android.a11y.AndroidCatalog
import app.talysman.android.account.Entitlement
import app.talysman.android.bridge.BridgeServer
import app.talysman.android.engine.EngineHost
import app.talysman.android.keys.KeyRepository
import app.talysman.android.service.EnforcementService

/** Process-wide singletons: the engine host, paired keys, the Android catalog, the plan. */
class TalysmanApp : Application() {
    lateinit var engine: EngineHost
        private set
    lateinit var keys: KeyRepository
        private set
    lateinit var catalog: AndroidCatalog
        private set
    lateinit var entitlement: Entitlement
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        catalog = AndroidCatalog.load(this)
        keys = KeyRepository(this)
        entitlement = Entitlement(this)
        engine = EngineHost(this)
        engine.hasPairedKeys = { keys.hasKeys() }
        engine.maxProfiles = entitlement.maxProfiles()
        engine.tick()
        EnforcementService.start(this)
        BridgeServer.start(this)
    }

    companion object {
        lateinit var instance: TalysmanApp
            private set
    }
}
