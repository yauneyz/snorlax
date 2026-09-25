//! JSON-in/JSON-out wasm facade over [`talysman_engine::Engine`]. Every argument and return value
//! is a JSON string of a type generated into packages/shared/src/generated; errors are thrown as
//! `EngineError` JSON. Wrapped for TypeScript by packages/engine-wasm/src/index.ts.

use serde::de::DeserializeOwned;
use talysman_engine::engine::{Command, PopupTarget};
use talysman_engine::model::{EngineState, ProfileConfig};
use talysman_engine::{Auth, Ctx, Engine, EngineError};
use wasm_bindgen::prelude::*;

extern crate serde;

fn parse<T: DeserializeOwned>(json: &str, what: &str) -> Result<T, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("{{\"code\":\"BAD_REQUEST\",\"message\":\"Bad {what}: {e}\"}}")))
}

fn to_json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("engine types serialize")
}

fn engine_error(e: EngineError) -> JsError {
    JsError::new(&to_json(&e))
}

#[wasm_bindgen]
pub struct WasmEngine {
    inner: Engine,
}

#[wasm_bindgen]
impl WasmEngine {
    /// Load persisted `EngineState` JSON.
    #[wasm_bindgen(constructor)]
    pub fn new(state_json: &str) -> Result<WasmEngine, JsError> {
        Ok(WasmEngine { inner: Engine::load(state_json).map_err(engine_error)? })
    }

    /// A fresh engine with no profiles.
    pub fn empty(device_id: &str) -> WasmEngine {
        WasmEngine { inner: Engine::new(EngineState::new(device_id)) }
    }

    /// Upgrade a v5 daemon state document.
    #[wasm_bindgen(js_name = fromV5)]
    pub fn from_v5(v5_json: &str, device_id: &str, default_color: &str, ever_enabled: bool, ctx_json: &str) -> Result<WasmEngine, JsError> {
        let v5: serde_json::Value = parse(v5_json, "v5 state")?;
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        let state = talysman_engine::migrate::from_v5(&v5, device_id, default_color, ever_enabled, &ctx.now);
        Ok(WasmEngine { inner: Engine::new(state) })
    }

    pub fn export(&self) -> String {
        to_json(&self.inner.state)
    }

    pub fn gate(&self, command_json: &str, ctx_json: &str) -> Result<String, JsError> {
        let command: Command = parse(command_json, "command")?;
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        Ok(to_json(&self.inner.gate(&command, &ctx)))
    }

    pub fn apply(&mut self, command_json: &str, auth_json: &str, ctx_json: &str) -> Result<String, JsError> {
        let command: Command = parse(command_json, "command")?;
        let auth: Auth = parse(auth_json, "auth")?;
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        Ok(to_json(&self.inner.apply(command, auth, &ctx).map_err(engine_error)?))
    }

    pub fn tick(&mut self, ctx_json: &str) -> Result<String, JsError> {
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        Ok(to_json(&self.inner.tick(&ctx)))
    }

    pub fn snapshot(&self, ctx_json: &str) -> Result<String, JsError> {
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        Ok(to_json(&self.inner.snapshot(&ctx)))
    }

    /// The flat policy the desktop network layer would enforce.
    #[wasm_bindgen(js_name = networkPolicy)]
    pub fn network_policy(&self, ctx_json: &str) -> Result<String, JsError> {
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        Ok(to_json(&self.inner.network_policy(&ctx)))
    }

    pub fn effective(&self, ctx_json: &str) -> Result<String, JsError> {
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        Ok(to_json(&self.inner.effective(&ctx)))
    }

    #[wasm_bindgen(js_name = popupInfo)]
    pub fn popup_info(&self, target_json: &str, ctx_json: &str) -> Result<String, JsError> {
        let target: PopupTarget = parse(target_json, "target")?;
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        Ok(to_json(&self.inner.popup_info(&target, &ctx)))
    }

    #[wasm_bindgen(js_name = decideUrl)]
    pub fn decide_url(&self, url: &str, extension_capable: bool, ctx_json: &str) -> Result<String, JsError> {
        let ctx: Ctx = parse(ctx_json, "ctx")?;
        Ok(to_json(&self.inner.decide_url(url, extension_capable, &ctx)))
    }
}

/// Every way `next` loosens `prev` (empty when it is at least as restrictive).
#[wasm_bindgen]
pub fn relaxations(prev_json: &str, next_json: &str, now_ms: f64) -> Result<String, JsError> {
    let prev: ProfileConfig = parse(prev_json, "config")?;
    let next: ProfileConfig = parse(next_json, "config")?;
    Ok(to_json(&talysman_engine::restrictive::relaxations(&prev, &next, now_ms as i64)))
}

/// Validation the engine applies to incoming configs; returns the error message or "".
#[wasm_bindgen(js_name = validateConfig)]
pub fn validate_config(config_json: &str) -> Result<String, JsError> {
    let config: ProfileConfig = parse(config_json, "config")?;
    Ok(talysman_engine::restrictive::validate(&config).err().unwrap_or_default())
}

/// `{ site, feature, route }` for a URL the catalog owns, or `null`.
#[wasm_bindgen(js_name = classifyUrl)]
pub fn classify_url(url: &str) -> String {
    match talysman_engine::site_catalog::classify_url(url) {
        Some(c) => format!(r#"{{"site":{},"feature":{},"route":{}}}"#, to_json(&c.site), to_json(&c.feature), c.route),
        None => "null".into(),
    }
}
