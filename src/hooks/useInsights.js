import { useState, useEffect, useCallback } from 'react';

export function useInsights(screen, userId) {
  const [data, setData] = useState(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(
        'https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/get-insights',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        }
      );
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('useInsights error:', e);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!data) return { insight: null, allInsights: [], aiContext: null, refresh };

  const insight = screen === 'insights'
    ? data.screens.insights?.[0] ?? null
    : data.screens[screen] ?? null;

  return {
    insight,
    allInsights: data.screens.insights ?? [],
    aiContext: data.screens.ai ?? null,
    refresh,
  };
}
