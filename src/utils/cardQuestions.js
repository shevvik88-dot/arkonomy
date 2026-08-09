// Long-press-on-a-card → prefilled AI chat question. Same static-template +
// real-data-substitution pattern as utils/lessons.js's getPersonalizedLessonNote
// — no AI call to generate the question, the existing ai-chat backend (which
// already has full financial context) answers it once sent.
//
// Takes `t` the same way tCat(category, t) already does elsewhere in this
// codebase, rather than owning its own translation strings.
export function getCardQuestion(cardKey, data, t) {
  switch (cardKey) {
    case "coach":
      return data.headline ? t("dashboard.card_question_coach", { headline: data.headline }) : null;
    case "creditCards":
      return data.pct != null && data.pct >= 0.30
        ? t("dashboard.card_question_credit_cards", { cardName: data.cardName })
        : t("dashboard.card_question_credit_cards_neutral");
    case "spending":
      return data.category ? t("dashboard.card_question_spending", { category: data.category }) : null;
    case "healthScore":
      return t("dashboard.card_question_health_score", { label: data.label });
    case "cashFlow":
      return t("dashboard.card_question_cash_flow");
    case "nextUp":
      return t("dashboard.card_question_next_up", { merchant: data.merchant, date: data.date });
    default:
      return null;
  }
}
