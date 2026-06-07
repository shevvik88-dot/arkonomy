function useInsights(screen, userId) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!userId) return;
    supabase.functions
      .invoke('get-insights', { body: { userId } })
      .then(({ data: result, error }) => {
        if (error) { console.error('useInsights error:', error); return; }
        setData(result);
      });
  }, [userId]);

  if (!data) return { insight: null, allInsights: [], aiContext: null };

  const insight = screen === "insights"
    ? data.screens?.insights?.[0] ?? null
    : data.screens?.[screen] ?? null;

  return {
    insight,
    allInsights: data.screens?.insights ?? [],
    aiContext: data.screens?.ai ?? null,
  };
}
