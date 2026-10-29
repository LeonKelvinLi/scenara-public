import { MarketOutcome } from "./market";
import { SourceTeam } from "./polymarket";
import { C } from "./theme";

export type OutcomeVisual = { id: number; color: string; logo?: string | null; abbreviation: string };
const normalized = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// Preserve source hues, lifting dark team colors so the lines stay legible.
function readableColor(value: string | null | undefined, fallback: string): string {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return fallback;
  let rgb = [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
  const brightness = () => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  while (brightness() < 130) rgb = rgb.map(channel => channel + (255 - channel) * .12);
  return "#" + rgb.map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("");
}

export function outcomeVisuals(outcomes: MarketOutcome[], teams: SourceTeam[] = []): OutcomeVisual[] {
  const visuals = outcomes.map((outcome, index) => {
    const label = normalized(outcome.title);
    const matches = teams.filter(team => [team.name, team.alias, team.abbreviation].some(name => {
      const candidate = normalized(name || "");
      return candidate.length >= 3 && (label === candidate || label.endsWith(candidate));
    }));
    const team = matches.length === 1 ? matches[0] : undefined;
    const fallback = label === "yes" ? C.GREEN : label === "no" ? C.RED : index === 0 ? C.BLUE : C.PINK;
    return { id: outcome.id, color: readableColor(team?.color, fallback), logo: team?.logo, identity: team?.name || outcome.title,
      abbreviation: label === "yes" ? "✓" : label === "no" ? "×" : team?.abbreviation?.toUpperCase() || outcome.title.split(/\s+/).map(word => word[0]).join("").slice(0, 3).toUpperCase() };
  });
  // Similar source colors need a distinct second line as well as text labels.
  if (visuals.length > 1) {
    const rgb = (color: string) => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    const first = rgb(visuals[0].color), second = rgb(visuals[1].color);
    if (Math.hypot(...first.map((channel, index) => channel - second[index])) < 45) {
      const firstIdentity = normalized(visuals[0].identity) < normalized(visuals[1].identity) ? 0 : 1;
      visuals[firstIdentity].color = "#F2C94C";
      visuals[1 - firstIdentity].color = "#E7EAF0";
    }
  }
  return visuals;
}
