const CHROMIUM_MANIFEST_DIRS: &[&str] = &[
    "/Library/Google/Chrome/NativeMessagingHosts",
    "/Library/Google/ChromeForTesting/NativeMessagingHosts",
    "/Library/Application Support/Chromium/NativeMessagingHosts",
    "/Library/Microsoft/Edge/NativeMessagingHosts",
    "/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    "/Library/Application Support/Vivaldi/NativeMessagingHosts",
    "/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts",
];
const FIREFOX_MANIFEST_DIRS: &[&str] =
    &["/Library/Application Support/Mozilla/NativeMessagingHosts"];

include!("../../../common/src/platform_extension_policy_unix.rs");
