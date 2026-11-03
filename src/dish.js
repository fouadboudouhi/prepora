// Calories from a photo. First the dish is named, then its usual make-up gives the numbers. A photo cannot show oil or
// how much is under the sauce, so the answer is a range, and the app shows no number at all when it would be a guess.
export const DISH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'isFood',
    'dish',
    'confidence',
    'reason',
    'portion',
    'kcalLow',
    'kcalHigh',
    'protein',
    'components',
  ],
  properties: {
    isFood: { type: 'boolean' },
    dish: { type: 'string' },
    confidence: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'] },
    reason: { type: 'string' },
    portion: { type: 'string' },
    kcalLow: { type: 'number' },
    kcalHigh: { type: 'number' },
    protein: { type: 'number' },
    components: { type: 'array', items: { type: 'string' } },
  },
};

export const DISH_SYSTEM = `Du schätzt Kalorien von Essen auf Fotos und bist dabei ehrlich über die Grenzen.

Vorgehen:
1. Erkenne, was das für ein Gericht ist und woraus es besteht. Nutze Teller, Besteck oder Verpackung, um die Menge einzuordnen.
2. Leite daraus die übliche Zusammensetzung und die Kalorien der sichtbaren Menge ab. "kcalLow" und "kcalHigh" sind eine ehrliche Spanne, die versteckte Fette, Öl und Saucen einschließt.

"confidence":
- "hoch": Gericht eindeutig, Menge gut einzuschätzen, wenig Versteckte Zutaten.
- "mittel": Gericht klar, Menge oder Zubereitung schwanken.
- "niedrig": Gericht unklar, stark verdeckt, Getränk ohne Inhaltsangabe, Bild unscharf oder Menge nicht einzuschätzen.

Rate nicht. Lieber "niedrig" und in "reason" kurz sagen, was fehlt. Kein Essen auf dem Bild: "isFood" ist false, die Zahlen sind 0. Wenn der Mensch das Gericht oder die Menge nennt, gilt seine Angabe. "reason" und "portion" sind kurz und auf Deutsch. "protein" ist die Eiweißmenge in Gramm.`;

const MAX_RATIO = 2;
const round = (value) => Math.round(value / 10) * 10;

// Decides what may be shown. This is the code's call, not Claude's: a range this wide is no estimate.
export function assessDish(result) {
  if (!result?.isFood) return { kind: 'notfood' };
  const { kcalLow: low, kcalHigh: high } = result;
  const usable = Number.isFinite(low) && Number.isFinite(high) && low > 0 && high >= low;
  if (result.confidence === 'niedrig' || !usable || high > low * MAX_RATIO) {
    return { kind: 'unsure', reason: result.reason, dish: result.dish };
  }
  return {
    kind: 'estimate',
    dish: result.dish,
    low: round(low),
    high: round(high),
    middle: round((low + high) / 2),
    protein: Math.round(result.protein ?? 0),
    confidence: result.confidence,
    portion: result.portion,
    components: result.components ?? [],
  };
}
