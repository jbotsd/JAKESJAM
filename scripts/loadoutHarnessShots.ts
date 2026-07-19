import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://192.168.4.58:5176";
const OUT_DIR = process.env.OUT_DIR ?? "/tmp/jakesjam-loadout-ui";
const VIEW = { width: 1920, height: 1080 };

const classes = [
  { classId: "wizard", characterId: "balanced" },
  { classId: "paladin", characterId: "heavy" },
  { classId: "ninja", characterId: "sprinter" },
  { classId: "priest", characterId: "shielded" },
] as const;

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: VIEW });

for (const review of classes) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/?ui=instant&quality=standard`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async ({ classId, characterId }) => {
    const [{ CardDraftOverlay }, { crystalRoundsCards }, { characters }] = await Promise.all([
      import("/src/game/ui/CardDraftOverlay.ts"),
      import("/src/sim/data/cards.ts"),
      import("/src/game/data/characters.ts"),
    ]);
    const overlay = new CardDraftOverlay(
      {},
      {
        kicker: "LOADOUT",
        title: "CHOOSE YOUR LOADOUT",
        hint: "Tap an ability below to equip it — up to 3 across your rack. Try it on the dummies. Walk away any time.",
      },
      {
        title: "CHOOSE YOUR CLASS",
        options: characters.map((character) => ({
          id: character.id,
          name: character.name,
          classId: character.classId,
          summary: character.kitSummary,
          kitComing: character.kitComing,
        })),
        selectedId: characterId,
        onSelect: () => undefined,
      },
    );
    overlay.setCatalog(
      crystalRoundsCards.filter((card) => card.classId === classId && card.active !== undefined),
      [],
      0,
      () => undefined,
    );
    overlay.showStation();
    (window as Window & { __jakesjam_loadout_review__?: object }).__jakesjam_loadout_review__ = overlay;
  }, review);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/${review.classId}-empty.png` });
  await page.evaluate(async ({ classId }) => {
    const { crystalRoundsCards } = await import("/src/sim/data/cards.ts");
    const catalog = crystalRoundsCards.filter(
      (card) => card.classId === classId && card.active !== undefined,
    );
    const selected = catalog.slice(0, 3).map((card) => card.id);
    const overlay = (window as Window & {
      __jakesjam_loadout_review__?: {
        setCatalog(cards: typeof catalog, ids: string[], held: number, onToggle: () => void): void;
      };
    }).__jakesjam_loadout_review__;
    overlay?.setCatalog(catalog, selected, selected.length, () => undefined);
  }, review);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT_DIR}/${review.classId}-full.png` });
  await page.close();
}

await context.close();
await browser.close();
console.log(`ok — four empty + four full loadout catalogs → ${OUT_DIR}`);
