const CHROMIUM_MANIFEST_DIRS: &[&str] = &[
    "/etc/opt/chrome/native-messaging-hosts",
    "/etc/opt/chrome_for_testing/native-messaging-hosts",
    "/etc/chromium/native-messaging-hosts",
    "/etc/opt/edge/native-messaging-hosts",
    "/etc/brave/native-messaging-hosts",
    "/etc/opt/vivaldi/native-messaging-hosts",
    "/etc/opt/opera/native-messaging-hosts",
];
const FIREFOX_MANIFEST_DIRS: &[&str] = &["/usr/lib/mozilla/native-messaging-hosts"];

include!("../../../common/src/platform_extension_policy_unix.rs");
