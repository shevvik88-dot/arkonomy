export function fmt(n, decimals = 2) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function guessCategory(description, type = "expense") {
  if (!description) return null;
  const d = description.toLowerCase();
  if (type === "income") {
    if (/salary|payroll|direct.?deposit|wages|paycheck/.test(d)) return "Salary";
    if (/freelance|consulting|contract|self.?employ/.test(d)) return "Freelance";
    if (/refund|reimburs|cashback|cash.?back/.test(d)) return "Refund";
    return null;
  }
  if (/transfer|zelle|venmo|paypal|cash.?app|wire|ach|atm |atm$|cash withdrawal|teller|check cashing/.test(d)) return "Transfer";
  if (/\bopenai\b/.test(d)) return "Bills";
  if (/\bclaude\b/.test(d)) return "Bills";
  if (/apple\.com\/bill/.test(d)) return "Bills";
  if (/\byoutube\b|\bnetflix\b|\bhulu\b|\bspotify\b|\bdisney\b/.test(d)) return "Entertainment";
  if (/insurance/.test(d)) return "Bills";
  if (/\btherapy\b|psych|\bmental\b|counseling/.test(d)) return "Health";
  if (/rent|lease|mortgage|apartment|hoa|homeowner|property mgmt|management fee/.test(d)) return "Housing";
  if (/grocery|groceries|supermarket|walmart|target|costco|trader.?joe|whole.?food|safeway|kroger|aldi|publix|h\.e\.b|wegman|food.?4.?less|sprouts|fresh market/.test(d)) return "Food & Dining";
  if (/restaurant|mcdonald|burger.?king|pizza|subway|starbucks|chipotle|taco.?bell|wendy|dunkin|chick.?fil|panera|doordash|ubereats|uber.?eats|grubhub|postmates|instacart|coffee|cafe|diner|bistro|sushi|grill|tavern|bbq|bakery|deli/.test(d)) return "Food & Dining";
  if (/uber|lyft|taxi|cab |parking|gas.?station|shell|chevron|exxon|bp |mobil|fuel|transit|metro|train|bus |amtrak|airline|delta|united|southwest|spirit|jetblue|toll |sunpass|fastrak|automobile|auto.?repair|mechanic|jiffy.?lube|oil.?change/.test(d)) return "Transport";
  if (/hotel|airbnb|vrbo|expedia|booking\.com|hotels\.com|marriott|hilton|hyatt|radisson|hampton.?inn|rental.?car|hertz|enterprise.?rent|avis|budget.?rent/.test(d)) return "Travel";
  if (/netflix|hulu|spotify|disney\+|amazon.?prime|apple.?tv|youtube.?premium|hbo|peacock|paramount\+|subscription|crunchyroll|tidal|siriusxm|pandora/.test(d)) return "Subscriptions";
  if (/doctor|physician|hospital|pharmacy|cvs|walgreens|rite.?aid|medical|dental|vision|health.?insur|urgent.?care|clinic|therapist|\btherapy\b|counseling|psych|\bmental\b|optometrist|youtalk|talkspace|betterhelp|cerebral|headspace|calm\.com|hims|hers|noom/.test(d)) return "Health";
  if (/electric|electricity|water.?bill|sewer|gas.?bill|utility|at&t|verizon|t-mobile|sprint|comcast|xfinity|spectrum|internet|phone.?bill|pge|pg&e|sdge/.test(d)) return "Utilities";
  if (/amazon|ebay|etsy|best.?buy|apple.?store|nike|zara|h&m|nordstrom|gap |old.?navy|macy|target\.com|walmart\.com|wayfair|shein|temu|wish\.com|shopify/.test(d)) return "Shopping";
  if (/gym|fitness|planet.?fitness|equinox|crossfit|yoga|peloton|24.?hour|la.?fitness|anytime.?fitness|crunch.?fitness/.test(d)) return "Health & Fitness";
  if (/movie|cinema|theater|concert|ticketmaster|stubhub|steam|playstation|xbox|gaming|regal|amc.?theater|bowling|mini.?golf|arcade/.test(d)) return "Entertainment";
  if (/salon|barber|spa |nail |massage|haircut|waxing|great.?clips|supercuts|beauty.?supply|ulta|sephora|laundry|dry.?clean/.test(d)) return "Personal Care";
  if (/tuition|university|college|student.?loan|udemy|coursera|skillshare|school|chegg|duolingo|masterclass/.test(d)) return "Education";
  if (/irs |tax.?payment|tax.?service|h&r.?block|turbotax|taxact|franchise.?tax|state.?tax|federal.?tax/.test(d)) return "Taxes";
  if (/dmv |department.?of|dept.?of|county.?of|city.?of|government|postal.?service|usps|court.?fee|traffic.?fine|parking.?ticket/.test(d)) return "Government";
  if (/donation|charity|nonprofit|non.?profit|church|temple|mosque|synagogue|red.?cross|goodwill|salvation.?army|habitat.?for.?humanity/.test(d)) return "Charity";
  if (/\bfee\b|service.?charge|annual.?charge|late.?fee|overdraft|account.?fee|maintenance.?fee|foreign.?transaction/.test(d)) return "Fees";
  if (/interest.?charge|credit.?card.?interest|finance.?charge|interest.?payment|loan.?interest|interest.?on.?loan|minimum.?payment|accrued.?interest/.test(d)) return "Cost of Debt";
  if (/insurance|geico|state.?farm|progressive|allstate|travelers|liberty.?mutual|farmers.?insur|usaa/.test(d)) return "Bills";
  return null;
}

// Zelle/Venmo override prevents double-counting rent classified as Housing by Plaid.
export function resolveCategory(t) {
  const raw = t.category_name;
  const desc = (t.description || '').toLowerCase();
  if (/\bzelle\b|\bvenmo\b/.test(desc)) return 'Transfers';
  if (!raw || raw === 'Other') {
    const guessed = guessCategory(t.description, t.type);
    if (guessed && guessed !== 'Transfer') return guessed;
  }
  return raw || 'Other';
}

const CAT_KEY_MAP = {
  "Housing":       "cat.housing",
  "Bills":         "cat.bills",
  "Subscriptions": "cat.subscriptions",
  "Shopping":      "cat.shopping",
  "Food & Dining": "cat.food_dining",
  "Transport":     "cat.transport",
  "Transportation":"cat.transport",
  "Entertainment": "cat.entertainment",
  "Health":        "cat.health",
  "Health & Fitness":"cat.health_fitness",
  "Personal Care": "cat.personal_care",
  "Travel":        "cat.travel",
  "Education":     "cat.education",
  "Taxes":         "cat.taxes",
  "Government":    "cat.government",
  "Charity":       "cat.charity",
  "Fees":          "cat.fees",
  "Cost of Debt":  "cat.cost_of_debt",
  "Utilities":     "cat.utilities",
  "Transfers":     "cat.transfers",
  "Transfer":      "cat.transfers",
  "Other":         "cat.other",
  "Income":        "cat.income",
};

export function tCat(name, t) {
  const key = CAT_KEY_MAP[name];
  return key ? t(key) : (name || "");
}

export function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

// Appends T00:00:00 to force local-time parsing (bare YYYY-MM-DD parses as UTC midnight).
export function parseDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr + "T00:00:00");
}

export function localDateString(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function fmtDate(dateStr) {
  return parseDate(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtPct(pct) {
  if (pct === null || pct === undefined) return "—";
  const v = Number(pct);
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

// Sign-safe transaction sum — always non-negative. A transaction's
// income/expense direction is determined by its `type` field, not by
// trusting the stored sign of `amount`; a stray negative-amount expense has
// previously flipped Net/Budget math inconsistently across screens, since
// each screen independently summed raw `amount` with its own .reduce().
// Callers filter the array first (by type, category exclusions, date
// range, etc.) — this only fixes the summation primitive, not what gets
// included.
export function sumAmounts(txs) {
  return (txs || []).reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
}

export function cleanMerchantName(raw) {
  if (!raw) return '';
  let s = raw.trim();

  if (s.includes(';')) {
    const parts = s.split(';').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) s = parts[parts.length - 1];
  }

  s = s.replace(/^(ACH\s+HOLD|ACH|POS\s+PURCHASE|POS|CHECKCARD|CHECK\s*CARD|PURCHASE|PREAUTH|PRE-AUTH|RECURRING\s+PMT|RECURRING|PYMT|PMT|DEBIT\s+CARD|DEBIT)\b\s*/i, '');
  s = s.replace(/^\d{4}\s+/, '');
  s = s.replace(/\s+ONLINE\s+PAY(?:MENT)?\s*$/i, '');
  s = s.replace(/\b(?:Des|Indn):\S+/gi, '');

  const subMatch = s.match(/\bSub\s+(.+)/i);
  if (subMatch) s = subMatch[1].trim();

  s = s.replace(/\b(?:Conf|Confirmation|Ref|Reference|Trans|Trace|Auth|Seq|Ck|Trn)[#:\s]*[\w-]{3,}/gi, '');
  s = s.replace(/#[A-Za-z0-9]{3,}/g, '');
  s = s.replace(/\b\d{1,2}\/\d{2}(?:\/\d{2,4})?\b/g, '');
  s = s.replace(/\s*#\s*\d{3,}\s*$/g, '');
  s = s.replace(/\b\d{8,}\b/g, '');
  s = s.replace(/\bId:\S+/gi, '');
  s = s.replace(/\b\d+\s+\w+\s+(?:Blvd?|Blv|Ave?|St|Dr|Rd|Ln|Ct|Pl|Way|Pkwy|Hwy)\b.*/i, '');
  s = s.replace(/,?\s*(Inc\.?|LLC\.?|Corp\.?|Ltd\.?|Co\.)\b.*/i, '');
  s = s.replace(/\s+Pos\s*$/i, '');
  s = s.replace(/\.\w{2,4}$/i, '');
  s = s.replace(/,\s*[^,]*\d[^,]*$/, '');
  s = s.replace(/\s+(?:\w+\s+)?Co\s+(?:Ppd|Web|Tel|Ccd|Iat|Arc|Ctx|Mte|Pop|Rck|Trc)\s*$/i, '');
  s = s.replace(/\s+[A-Za-z]{4,}\s+Co\s*$/i, '');
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return '';

  s = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  s = s.replace(/'S\b/g, "'s");

  const BRAND_FIX = [
    [/\bBkofamerica\b/i,         'Bank of America'],
    [/\bMcdonald'?s\b/i,         "McDonald's"],
    [/\bMcdonalds\b/i,           "McDonald's"],
    [/\bTrader\s+Joe'?s\b/i,     "Trader Joe's"],
    [/\bCvs\b/i,                 'CVS'],
    [/\bEbay\b/i,                'eBay'],
    [/\bPaypal\b/i,              'PayPal'],
    [/\bGithub\b/i,              'GitHub'],
    [/\bYoutube\b/i,             'YouTube'],
    [/\bLinkedin\b/i,            'LinkedIn'],
    [/\bWalmart\b/i,             'Walmart'],
    [/\bGood\s+Life\s+Restor\w*/i, 'Good Life Restoration'],
    [/\bYoutalk\b.*/i,             'YouTalk'],
    [/\bUsps\b/i,           'USPS'],
    [/\bAtm\b/i,            'ATM'],
    [/\bAch\b/i,            'ACH'],
    [/\bgolden\s*one\b.*/i, 'Golden One Credit Union'],
  ];
  for (const [pattern, replacement] of BRAND_FIX) {
    s = s.replace(pattern, replacement);
  }

  if (s.length > 30) s = s.slice(0, 29).trimEnd() + '…';

  return s;
}
