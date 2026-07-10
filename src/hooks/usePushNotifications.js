import { logger } from "../utils/logger";
// src/hooks/usePushNotifications.js
// Registers the browser's push subscription and saves it to Supabase.
// The subscription is stored in profiles.push_subscription (JSONB).
//
// Prerequisites:
//   1. Generate a VAPID key pair:
//        npx web-push generate-vapid-keys
//   2. Set the private key as a Supabase secret:
//        supabase secrets set VAPID_PRIVATE_KEY=<private_key>
//   3. Replace VAPID_PUBLIC_KEY below with your actual public key.
//
// SQL migration required:
//   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_subscription JSONB;

import { useEffect, useRef } from 'react';

const VAPID_PUBLIC_KEY = 'BA0f1fvfHl4nYhqntmNAu0YLc_UXcGz4RSj3X9JSM0DHa075qQpmOCkjln_rhpGlZ1laheNigwpeGmgMOFMgTsw';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * usePushNotifications(supabase, userId)
 *
 * Requests notification permission, registers a push subscription,
 * and saves it to Supabase so the push-notify edge function can use it.
 *
 * Safe to call multiple times — skips re-registration if already subscribed.
 */
export function usePushNotifications(supabase, userId) {
  const registered = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    async function register() {
      if (registered.current) return;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly:      true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        const { error: dbErr } = await supabase
          .from('profiles')
          .update({ push_subscription: sub.toJSON() })
          .eq('id', userId);

        if (dbErr) {
          logger.warn('[Arkonomy] Push subscription DB write failed:', dbErr);
          return;
        }

        registered.current = true;
      } catch (err) {
        logger.warn('[Arkonomy] Push registration failed:', err);
      }
    }

    register();

    // Pick up re-granted permissions without requiring re-login
    let permStatus;
    navigator.permissions.query({ name: 'notifications' }).then(status => {
      permStatus = status;
      status.onchange = () => { if (status.state === 'granted') register(); };
    });

    return () => { if (permStatus) permStatus.onchange = null; };
  }, [supabase, userId]);
}
