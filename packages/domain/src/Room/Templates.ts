import * as Schema from "effect/Schema";

export const Template = Schema.Literals([
  "mad-sad-glad",
  "start-stop-continue",
  "went-well-improve-try",
  "keep-drop-try",
]);

export type Template = typeof Template.Type;

const make = (ids: string[], titles: string[], descriptions: string[], icons: string[]) =>
  titles.map((title, i) => ({
    id: ids[i]!,
    tone: ["rose", "slate", "mint"][i]!,
    title,
    description: descriptions[i]!,
    icon: icons[i]!,
  }));

export const templates = {
  "mad-sad-glad": {
    title: "Mad / Sad / Glad",
    description: "Make space for how the sprint felt.",
    columns: make(
      ["mad", "sad", "glad"],
      ["Mad", "Sad", "Glad"],
      [
        "Frustrations, blockers, things that slowed us down.",
        "Disappointments, challenges, things that didn’t go as planned.",
        "Wins, progress, things that went well.",
      ],
      ["cloud-lightning", "cloud-rain", "sun"],
    ),
  },
  "start-stop-continue": {
    title: "Start / Stop / Continue",
    description: "Choose practical changes for the next sprint.",
    columns: make(
      ["start", "stop", "continue"],
      ["Start", "Stop", "Continue"],
      [
        "New habits and experiments worth starting.",
        "Things that get in our way or no longer help.",
        "What’s working and deserves to continue.",
      ],
      ["play", "stop", "repeat"],
    ),
  },
  "went-well-improve-try": {
    title: "Went Well / Improve / Try",
    description: "Celebrate progress and explore what’s next.",
    columns: make(
      ["went-well", "improve", "try"],
      ["Went Well", "Improve", "Try"],
      [
        "Successes and moments worth celebrating.",
        "Where we could make things better.",
        "Ideas and experiments for the next sprint.",
      ],
      ["sun", "trend-up", "lightbulb"],
    ),
  },
  "keep-drop-try": {
    title: "Keep / Drop / Try",
    description: "Simplify your process and try something new.",
    columns: make(
      ["keep", "drop", "try"],
      ["Keep", "Drop", "Try"],
      [
        "Practices that help us do our best work.",
        "Habits and processes we can let go of.",
        "Something new we’d like to experiment with.",
      ],
      ["heart", "minus-circle", "lightbulb"],
    ),
  },
};

export const columnsFor = (template?: Template) =>
  templates[template ?? "mad-sad-glad"].columns;

export const tallyNotes = (template: Template, notes: ReadonlyArray<{ column: string }>): Record<string, number> =>
  Object.fromEntries(columnsFor(template).map(({ id }) => [id, notes.filter((note) => note.column === id).length]));
