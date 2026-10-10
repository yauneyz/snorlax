import React, { useEffect, useState } from 'react';
import type { AppMessage } from '@talysman/product';
import { openExternal } from '../lib/bridge.js';

/**
 * Messages we pushed to this app from the server (main/appMessages.ts). Each stays until the
 * user dismisses it, which also stops the server serving it to this device again.
 */
export function AppMessageBanners() {
  const [messages, setMessages] = useState<AppMessage[]>([]);

  useEffect(() => {
    const load = () => void window.api.appMessages().then(setMessages);
    load();
    return window.api.onAppEvent((event) => {
      if (event === 'messagesChanged') load();
    });
  }, []);

  if (messages.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-5 pt-3">
      {messages.map((message) => (
        <div
          key={message.id}
          className="mx-auto flex w-full max-w-[960px] items-start gap-3 rounded-[14px] border border-accent/30 bg-accent/[0.06] p-4 text-body"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-200">{message.title}</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-400">{message.body}</p>
            {message.linkUrl && (
              <button
                onClick={() => void openExternal(message.linkUrl!)}
                className="mt-2 font-medium text-accent hover:underline"
              >
                {message.linkLabel ?? 'Open link'}
              </button>
            )}
          </div>
          <button
            onClick={() => void window.api.dismissAppMessage(message.id)}
            className="rounded px-2 py-0.5 font-medium text-slate-400 hover:bg-white/10"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
