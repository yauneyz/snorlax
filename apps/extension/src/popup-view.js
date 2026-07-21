function activeDescription(mode) {
  if (mode === 'whitelist') return 'Only the sites allowed by your focus policy can load.';
  if (mode === 'block-all') return 'Browser requests are blocked by your focus policy.';
  return 'Sites in your focus blocklist are blocked in this browser.';
}

/** Convert private background state into the small, user-facing read-only status model. */
export function getStatusView(status) {
  if (!status || typeof status !== 'object') {
    return {
      tone: 'warning',
      heading: 'Status unavailable',
      description: 'Close and reopen this panel while Talysman reconnects.',
      connection: 'Unavailable',
      focus: 'Unknown',
    };
  }

  const hasState = status.hasReceivedState === true;
  const active = status.focusActive === true;
  const connection = status.connection;

  if (hasState && status.health && status.health.canBlock === false) {
    return {
      tone: 'danger',
      heading: 'Protection needs attention',
      description: 'The browser could not apply the latest Talysman rules.',
      connection: connection === 'connected' ? 'Connected' : 'Reconnecting…',
      focus: active ? 'Active' : 'Inactive',
    };
  }

  if (connection !== 'connected') {
    if (hasState && active) {
      return {
        tone: 'warning',
        heading: 'Reconnecting safely',
        description: 'The last applied browser rules remain in place while Talysman reconnects.',
        connection: connection === 'connecting' ? 'Reconnecting…' : 'Unavailable',
        focus: 'Active (last known)',
      };
    }

    return {
      tone: 'neutral',
      heading: hasState ? 'Talysman is unavailable' : 'Connecting to Talysman',
      description: hasState
        ? 'Start the desktop app to synchronize browser protection.'
        : 'Checking the desktop connection and browser protection.',
      connection: connection === 'connecting' ? 'Connecting…' : 'Unavailable',
      focus: hasState ? 'Inactive (last known)' : 'Checking…',
    };
  }

  if (active) {
    return {
      tone: 'active',
      heading: 'Focus protection is active',
      description: activeDescription(status.mode),
      connection: 'Connected',
      focus: 'Active',
    };
  }

  return {
    tone: 'neutral',
    heading: 'Focus is inactive',
    description: 'Talysman is connected. No browser blocking rules are active.',
    connection: 'Connected',
    focus: 'Inactive',
  };
}
