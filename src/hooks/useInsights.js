function useInsights(screen, userId) {
  const [data, setData] = useState(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const { data: result, error } = await supabase.functions.invoke(
        'get-insights',
        { body: { userId } }
      );
      if (error) { console.error('useInsights error:', error); return; }
      setData(result);
    } catch (e) {
      console.error('useInsights error:', e);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!data) return { insight: null, allInsights: [], aiContext: null, refresh };

  const insight = screen === "insights"
    ? data.screens?.insights?.[0] ?? null
    : data.screens?.[screen] ?? null;

  return {
    insight,
    allInsights: data.screens?.insights ?? [],
    aiContext: data.screens?.ai ?? null,
    refresh,
  };
}
