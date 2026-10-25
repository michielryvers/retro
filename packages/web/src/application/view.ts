import * as Match from "effect/Match";
import { Template, templates, columnsFor } from "@retro/domain/Room/Templates";
import { sortByVotes } from "../voteSort.ts";
import { availableVotes, phaseConfirmation } from "../roomProgress.ts";
import * as Schema from "effect/Schema";
import type { Document } from "foldkit/html";
import { Button, Input, Textarea, Select } from "@foldkit/ui";
import { BoardState, Column } from "@retro/domain/Room/Values";
import { Message, Op, ToolAction, Field } from "./definition.ts";
import { ApplicationComposition } from "./composition.ts";

const steps = [
  { id: "write", title: "Write", caption: "Add your notes" },
  { id: "reveal", title: "Reveal", caption: "See everyone’s notes" },
  { id: "vote", title: "Vote", caption: "Choose what matters" },
  { id: "actions", title: "Actions", caption: "Turn insights into next steps" },
];

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export const view = ApplicationComposition.makeView((m, h): Document => {
  const icon = (name: string) =>
    h.i([h.Class(`ph ph-${name}`), h.AriaHidden(true)]);

  const button = (
    text: string,
    msg: Message,
    style = "secondary",
    disabled = false,
    ic?: string,
  ) =>
    Button.view(
      {
        onClick: msg,
        isDisabled: disabled || (m.busy && !m.pendingVote),
        toView: (a) =>
          h.button(
            [
              ...a.button,
              h.Class(`button ${style}`),
              ...(style === "icon-button"
                ? [h.AriaLabel(text), h.Title(text)]
                : []),
            ],
            [
              ...(ic ? [icon(ic)] : []),
              ...(style === "icon-button" ? [] : [text]),
            ],
          ),
      },
      h,
    );

  const field = (
    id: typeof Field.Type,
    label: string,
    value: string,
    placeholder = "",
    type = "text",
  ) =>
    Input.view(
      {
        id,
        value,
        type,
        placeholder,
        onInput: (value) => Message.Field({ field: id, value }),
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label([...a.label], [label]),
              h.div(
                [h.Class("input-control")],
                [
                  h.input([
                    ...a.input,
                    h.Disabled(m.busy),
                    h.Maxlength(
                      Match.value(id).pipe(
                        Match.when("name", () => 40),
                        Match.when("title", () => 100),
                        Match.orElse(() => 500),
                      ),
                    ),
                  ]),
                  id === "password"
                    ? h.button(
                        [
                          h.Type("button"),
                          h.Class("password-toggle"),
                          h.AriaLabel(
                            m.showPassword ? "Hide password" : "Show password",
                          ),
                          h.Disabled(m.busy),
                          h.OnClick(Message.TogglePassword()),
                        ],
                        [icon(m.showPassword ? "eye-slash" : "eye")],
                      )
                    : null,
                ],
              ),
            ],
          ),
      },
      h,
    );

  const textarea = (
    id: "draft" | "action",
    label: string,
    value: string,
    placeholder: string,
  ) =>
    Textarea.view(
      {
        id,
        value,
        placeholder,
        rows: 3,
        onInput: (value) => Message.Field({ field: id, value }),
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label(
                [...a.label, ...(id === "action" ? [] : [h.Class("sr-only")])],
                [label],
              ),
              h.textarea([
                ...a.textarea,
                h.Maxlength(id === "action" ? 500 : 2000),
                h.Disabled(m.busy),
              ]),
            ],
          ),
      },
      h,
    );

  const run = (op: typeof Op.Type, id = "", selected = false) =>
    Message.Run({ op, id, selected });

  const columns = columnsFor(m.board?.template ?? m.template);

  const writingPrompts = new Map([
    ["Start", "What should we start doing?"],
    ["Stop", "What should we stop doing?"],
    ["Continue", "What should we keep doing?"],
    ["Mad", "What frustrated you?"],
    ["Sad", "What was disappointing?"],
    ["Glad", "What went well?"],
    ["Went Well", "What went well?"],
    ["Improve", "What could be better?"],
    ["Try", "What could we try next?"],
    ["Keep", "What should we keep doing?"],
    ["Drop", "What can we let go of?"],
  ]);

  const feedback = () =>
    h.div(
      [h.Class("feedback")],
      [
        m.error
          ? h.div(
              [h.Class("error"), h.Role("alert")],
              [icon("warning-circle"), m.error],
            )
          : null,
        m.notice
          ? h.p(
              [h.Role("status"), h.Class("notice")],
              [icon("check-circle"), m.notice],
            )
          : null,
      ],
    );

  if (m.unavailable)
    return {
      title: "Retrospective deleted",
      body: h.main(
        [h.Class("unavailable-room")],
        [
          h.h1([], ["This retrospective has been deleted"]),
          h.p([], ["Its notes and actions are no longer available."]),
          h.a(
            [h.Href("/"), h.Class("button primary")],
            ["Back to retrospectives"],
          ),
        ],
      ),
    };

  if (!m.entered || !m.board)
    return {
      title: "Retro",
      body: h.div(
        [h.Class("welcome")],
        [
          h.main(
            [h.Class("welcome-main")],
            [
              h.form(
                [h.Class("entry-form"), h.OnSubmit(Message.Enter())],
                [
                  h.a(
                    [h.Class("entry-brand"), h.Href("/")],
                    [
                      h.img([h.Src("/retro.svg"), h.Alt("")]),
                      h.span([], ["Retro"]),
                    ],
                  ),
                  h.h2(
                    [],
                    [
                      m.roomId
                        ? m.invitationPreview
                          ? `Hi, ${m.invitationPreview.name}.`
                          : "Join the retrospective"
                        : "Create a retrospective",
                    ],
                  ),
                  m.roomId && m.invitationPreview
                    ? h.p(
                        [h.Class("invitation-welcome")],
                        [
                          "You’re invited to ",
                          h.strong([], [m.invitationPreview.title]),
                          ".",
                        ],
                      )
                    : null,
                  m.roomId && !m.inviteToken
                    ? h.p(
                        [h.Class("subtle")],
                        [
                          "Ask your facilitator for your personal invitation link.",
                        ],
                      )
                    : null,
                  ...(!m.roomId
                    ? [
                        field(
                          "title",
                          "Room name",
                          m.title,
                          "e.g. Sprint 24 retrospective",
                        ),
                      ]
                    : []),
                  !m.roomId
                    ? h.fieldset(
                        [h.Class("template-picker")],
                        [
                          h.legend([], ["Retrospective format"]),
                          ...Object.entries(templates).map(([id, template]) =>
                            h.label(
                              [
                                h.Class(
                                  `template-option ${m.template === id ? "selected" : ""}`,
                                ),
                              ],
                              [
                                h.input([
                                  h.Type("radio"),
                                  h.Name("template"),
                                  h.Value(id),
                                  h.Checked(m.template === id),
                                  h.Disabled(m.busy),
                                  h.OnChange(() =>
                                    Message.Template({
                                      template:
                                        Schema.decodeUnknownSync(Template)(id),
                                    }),
                                  ),
                                ]),
                                h.strong(
                                  [h.Class("format-categories")],
                                  template.title
                                    .split(" / ")
                                    .flatMap((name, index) => [
                                      ...(index
                                        ? [
                                            h.span(
                                              [h.Class("format-separator")],
                                              ["/"],
                                            ),
                                          ]
                                        : []),
                                      h.span(
                                        [
                                          h.Class(
                                            `format-category format-category-${index}`,
                                          ),
                                        ],
                                        [name],
                                      ),
                                    ]),
                                ),
                              ],
                            ),
                          ),
                        ],
                      )
                    : null,
                  !m.roomId
                    ? field("name", "Your name", m.name, "e.g. Alex")
                    : null,
                  !m.roomId || m.inviteToken
                    ? field(
                        "password",
                        "Room password",
                        m.password,
                        !m.roomId
                          ? "At least 3 characters"
                          : "Password from your facilitator",
                        m.showPassword ? "text" : "password",
                      )
                    : null,
                  feedback(),
                  !m.roomId
                    ? h.p(
                        [h.Class("muted")],
                        [
                          "Rooms close after 7 days and are deleted 7 days after closing.",
                        ],
                      )
                    : null,

                  !m.roomId || m.inviteToken
                    ? Button.view(
                        {
                          type: "submit",
                          isDisabled:
                            m.busy ||
                            (!m.roomId &&
                              (!m.name.trim() ||
                                !m.title.trim() ||
                                m.password.length < 3)) ||
                            (Boolean(m.roomId) &&
                              (!m.inviteToken || !m.password)),
                          toView: (a) =>
                            h.button(
                              [
                                ...a.button,
                                h.Class(
                                  `button primary wide ${m.busy ? "entry-loading" : ""}`,
                                ),
                              ],
                              [
                                m.busy
                                  ? m.roomId
                                    ? "Joining your room…"
                                    : "Creating your room…"
                                  : m.roomId
                                    ? "Join room"
                                    : "Create room",
                                m.busy
                                  ? h.span(
                                      [
                                        h.Class("loading-notes"),
                                        h.AriaHidden(true),
                                      ],
                                      [h.span([]), h.span([]), h.span([])],
                                    )
                                  : icon("arrow-right"),
                              ],
                            ),
                        },
                        h,
                      )
                    : null,
                  h.div(
                    [
                      h.Class("entry-progress"),
                      h.Role("status"),
                      h.AriaLive("polite"),
                    ],
                    [
                      m.busy
                        ? m.roomId
                          ? "Finding your seat…"
                          : "Putting the sticky notes out…"
                        : "",
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    };
  const b = m.board;
  const me = b.participants.find((p) => p.id === m.actorId);
  const admin = b.adminId === m.actorId;

  const timerMs = b.timer?.endsAt
    ? Math.max(0, b.timer.endsAt - m.now)
    : (b.timer?.remainingMs ?? 0);

  const timerSeconds = Math.ceil(timerMs / 1000);
  const timerText = `${Math.floor(timerSeconds / 60)}:${String(timerSeconds % 60).padStart(2, "0")}`;

  const tool = (action: typeof ToolAction.Type, seconds = 0) =>
    Message.Tool({ action, seconds });

  const writing = b.phase === "write";
  const canCombine = admin && b.phase === "reveal";
  const active = steps.findIndex((s) => s.id === b.phase);
  const allNotes = writing ? m.private.notes : b.notes;

  const visibleNotes =
    m.actionsOnly && !writing
      ? allNotes.filter((n) => b.actions.some((a) => a.noteId === n.id))
      : allNotes;

  const columnCount = (id: typeof Column.Type) =>
    m.actionsOnly
      ? visibleNotes.filter((n) => n.column === id).length
      : (b.tally[id] ?? 0);

  const ready = b.participants.filter((p) => p.ready).length;

  const titles = {
    write: "Write notes",
    reveal: "Review notes",
    vote: "Vote on notes",
    actions: "Plan actions",
    closed: "Retrospective complete",
  };

  const avatar = (p: BoardState["participants"][number], i: number) =>
    h.span(
      [
        h.Class(`avatar color-${i % 6}`),
        h.Title(p.name + (p.id === m.actorId ? " (you)" : "")),
      ],
      [initials(p.name)],
    );

  const selected = b.notes.find((n) => n.id === m.selected);

  const score = (id: string) =>
    b.scores.find((s) => s.noteId === id)?.count ?? 0;

  const resultsVisible = b.phase === "actions" || b.phase === "closed";

  const actionForm =
    admin && selected && b.phase === "actions"
      ? h.form(
          [h.Class("action-form"), h.OnSubmit(run("action"))],
          [
            textarea(
              "action",
              "What will we do?",
              m.action,
              "A concrete next step",
            ),
            h.div(
              [h.Class("form-row")],
              [
                Select.view(
                  {
                    id: "owner",
                    value: m.owner,
                    onChange: (value) =>
                      Message.Field({ field: "owner", value }),
                    toView: (a) =>
                      h.div(
                        [h.Class("field")],
                        [
                          h.label([...a.label], ["Owner"]),
                          h.select(
                            [...a.select],
                            [
                              h.option([h.Value("")], ["Choose an owner"]),
                              ...b.participants.map((p) =>
                                h.option([h.Value(p.id)], [p.name]),
                              ),
                            ],
                          ),
                        ],
                      ),
                  },
                  h,
                ),
                field("due", "Due date (optional)", m.due, "", "date"),
              ],
            ),
            h.div(
              [h.Class("action-form-controls")],
              [
                button(
                  "Save action",
                  run("action"),
                  "primary",
                  m.busy || !m.action.trim(),
                  "check",
                ),
                button(
                  "Cancel",
                  Message.Select({ id: "" }),
                  "secondary",
                  m.busy,
                ),
              ],
            ),
          ],
        )
      : null;

  const primary = Match.value(b.phase).pipe(
    Match.when("write", () => ({
      op: "reveal" as const,
      label: "Reveal notes",
      icon: "eye",
    })),
    Match.when("reveal", () => ({
      op: "startVote" as const,
      label: "Start voting",
      icon: "hand-pointing",
    })),
    Match.when("vote", () => ({
      op: "finishVote" as const,
      label: "Finish voting",
      icon: "chart-bar",
    })),
    Match.when("actions", () => ({
      op: "close" as const,
      label: "Close retrospective",
      icon: "check-circle",
    })),
    Match.orElse(() => null),
  );

  return {
    title: `${b.title} · Retrospective`,
    body: h.div(
      [
        h.Class(
          `app-shell ${b.phase === "closed" ? "closed-screen" : ""} ${selected ? "action-editing" : ""} ${writing ? "writing-screen" : ""} ${admin ? "facilitator-screen" : "participant-screen"}`,
        ),
      ],
      [
        h.header(
          [h.Class("mobile-room-header")],
          [
            h.div(
              [h.Class("mobile-room-top")],
              [
                h.img([
                  h.Class("room-logo"),
                  h.Src("/retro.svg"),
                  h.Alt("Retro"),
                ]),
                h.strong([], [b.title]),
                h.div(
                  [h.Class("mobile-presence")],
                  [
                    h.div(
                      [h.Class("participant-stack")],
                      b.participants
                        .slice(0, 3)
                        .map((p, i) =>
                          h.span(
                            [
                              h.Class(
                                `participant-stamp ${writing && p.ready ? "is-ready" : ""}`,
                              ),
                              h.AriaLabel(
                                `${p.name}${writing && p.ready ? ", ready" : ""}`,
                              ),
                            ],
                            [
                              avatar(p, i),
                              writing && p.ready ? icon("check") : null,
                            ],
                          ),
                        ),
                    ),
                    h.span(
                      [h.Class("subtle")],
                      [
                        `${b.participants.length} ${b.participants.length === 1 ? "person" : "people"}`,
                      ],
                    ),
                  ],
                ),
                h.button(
                  [
                    h.Class("mobile-menu-button"),
                    h.AriaLabel("Room menu"),
                    h.AriaExpanded(m.mobileMenu || m.invite || m.toolsOpen),
                    h.OnClick(Message.MobileMenu()),
                  ],
                  [icon("dots-three")],
                ),
              ],
            ),
            h.div(
              [h.Class("mobile-room-status"), h.Role("status")],
              [
                h.span(
                  [h.Key(b.phase)],
                  [
                    b.phase === "closed"
                      ? b.archived
                        ? "Archived · read-only"
                        : "Session complete"
                      : `${writing ? "Writing" : steps[active]?.title} · ${active + 1} of 4`,
                  ],
                ),
                !m.connected
                  ? h.span([h.Class("connection")], ["Reconnecting…"])
                  : null,
                b.phase !== "closed" &&
                (b.timer?.endsAt || b.timer?.remainingMs)
                  ? h.span(
                      [
                        h.Class("mobile-countdown"),
                        h.AriaLabel("Shared timer"),
                      ],
                      [
                        icon("timer"),
                        timerText,
                        !b.timer?.endsAt
                          ? " · paused"
                          : !timerSeconds
                            ? " · time’s up"
                            : "",
                      ],
                    )
                  : null,
              ],
            ),
          ],
        ),
        h.aside(
          [h.Class("sidebar")],
          [
            h.div(
              [h.Class("room-info")],
              [
                h.img([
                  h.Class("room-logo"),
                  h.Src("/retro.svg"),
                  h.Alt("Retro"),
                ]),
                h.h2([], [b.title]),
                h.p(
                  [h.Class("subtle")],
                  [
                    `${b.participants.length} ${b.participants.length === 1 ? "person" : "people"} in this room`,
                  ],
                ),
              ],
            ),
            h.nav(
              [h.AriaLabel("Retrospective progress"), h.Class("steps")],
              steps.map((s, i) =>
                h.div(
                  [
                    h.Class(
                      `step ${i === active ? "current" : ""} ${i < active || b.phase === "closed" ? "complete" : ""}`,
                    ),
                    ...(i === active ? [h.AriaCurrent("step")] : []),
                  ],
                  [
                    h.span(
                      [h.Class("step-marker")],
                      [
                        i < active || b.phase === "closed"
                          ? icon("check")
                          : String(i + 1),
                      ],
                    ),
                    h.div(
                      [],
                      [h.strong([], [s.title]), h.span([], [s.caption])],
                    ),
                  ],
                ),
              ),
            ),
            h.div(
              [h.Class("sidebar-bottom")],
              [
                h.p(
                  [],
                  [
                    icon(admin ? "crown-simple" : "user"),
                    admin ? "You’re facilitating" : "You’re participating",
                  ],
                ),
              ],
            ),
          ],
        ),
        h.main(
          [h.Class("workspace")],
          [
            b.phase !== "closed"
              ? h.header(
                  [h.Class("board-header")],
                  [h.h1([h.Key(b.phase)], [titles[b.phase]])],
                )
              : null,
            h.div(
              [h.Class("board-tools")],
              [
                h.div(
                  [h.Class("presence")],
                  [
                    ...b.participants.slice(0, 6).map(avatar),
                    b.participants.length > 6
                      ? h.span(
                          [h.Class("avatar")],
                          [`+${b.participants.length - 6}`],
                        )
                      : null,
                  ],
                ),
                h.span(
                  [h.Class("connection")],
                  [
                    icon(m.connected ? "broadcast" : "wifi-slash"),
                    m.connected ? "Live" : "Reconnecting",
                  ],
                ),
                admin
                  ? button(
                      "People & invites",
                      Message.Invite(),
                      "quiet",
                      false,
                      "user-plus",
                    )
                  : null,
                b.phase === "actions"
                  ? button(
                      "Export",
                      Message.Export(),
                      "quiet",
                      false,
                      "download-simple",
                    )
                  : null,
              ],
            ),
            h.dialog(
              [
                h.Id("room-sheet"),
                h.Open(true),
                h.Class(
                  `room-sheet section-${m.roomSection} ${m.mobileMenu || m.invite || m.toolsOpen ? "sheet-active" : ""}`,
                ),
                h.AriaLabel("Room"),
              ],
              [
                h.div(
                  [h.Class("room-sheet-heading")],
                  [
                    h.h2([], ["Room"]),
                    h.button(
                      [
                        h.Type("button"),
                        h.Class("button quiet room-sheet-close"),
                        h.AriaLabel("Close room"),
                        h.OnClick(Message.CloseRoom()),
                      ],
                      [icon("x")],
                    ),
                  ],
                ),
                h.nav(
                  [h.Class("room-sheet-tabs"), h.AriaLabel("Room sections")],
                  (
                    [
                      "people",
                      ...(admin && b.phase !== "closed"
                        ? [
                            "timer",
                            ...(b.participants.some((p) => p.id !== m.actorId)
                              ? ["handover"]
                              : []),
                          ]
                        : []),
                    ] as const
                  ).map((section) =>
                    h.button(
                      [
                        h.Type("button"),
                        h.Class(
                          `button ${m.roomSection === section ? "primary" : "secondary"}`,
                        ),
                        h.AriaPressed(String(m.roomSection === section)),
                        h.OnClick(
                          Message.RoomSection({
                            section: Schema.decodeUnknownSync(
                              Schema.Literals(["people", "timer", "handover"]),
                            )(section),
                          }),
                        ),
                      ],
                      [
                        new Map([
                          ["people", "People"],
                          ["timer", "Timer"],
                          ["handover", "Handover"],
                        ]).get(section) ?? section,
                      ],
                    ),
                  ),
                ),
                !admin && m.mobileMenu
                  ? h.div(
                      [h.Class("room-sheet-people")],
                      b.participants.map((p) =>
                        h.p(
                          [],
                          [
                            p.name +
                              (p.id === b.adminId ? " · facilitator" : ""),
                          ],
                        ),
                      ),
                    )
                  : null,
                h.div(
                  [
                    h.Class(
                      `controls-surface ${m.toolsOpen && admin ? "is-open" : ""}`,
                    ),
                    ...(m.toolsOpen && admin
                      ? [h.Role("region"), h.AriaLabel("Facilitator controls")]
                      : []),
                  ],
                  [
                    h.div(
                      [h.Class("room-toolbar")],
                      [
                        b.phase !== "closed" &&
                        (admin || b.timer?.endsAt || b.timer?.remainingMs)
                          ? h.section(
                              [
                                h.Class(
                                  `room-timer ${m.toolsOpen && admin ? "controls-open" : ""}`,
                                ),
                                h.AriaLabel("Shared session timer"),
                              ],
                              [
                                h.div(
                                  [h.Class("timer-display")],
                                  [
                                    icon("timer"),
                                    b.timer?.endsAt || timerSeconds
                                      ? h.strong([], [timerText])
                                      : null,
                                    h.span(
                                      [],
                                      [
                                        b.timer?.endsAt
                                          ? timerSeconds
                                            ? "Time remaining"
                                            : "Time’s up · continue when ready"
                                          : timerSeconds
                                            ? "Paused"
                                            : "Timer",
                                      ],
                                    ),
                                  ],
                                ),
                                admin
                                  ? h.div(
                                      [h.Class("tool-buttons")],
                                      [
                                        !timerSeconds
                                          ? button(
                                              "5 min",
                                              tool("start", 300),
                                              "quiet",
                                            )
                                          : null,
                                        !timerSeconds
                                          ? button(
                                              "10 min",
                                              tool("start", 600),
                                              "quiet",
                                            )
                                          : null,
                                        b.timer?.endsAt && timerSeconds
                                          ? button(
                                              "Pause",
                                              tool("pause"),
                                              "secondary",
                                            )
                                          : timerSeconds
                                            ? button(
                                                "Resume",
                                                tool("resume"),
                                                "secondary",
                                              )
                                            : null,
                                        b.timer?.endsAt || timerSeconds
                                          ? button(
                                              "+1 min",
                                              tool("extend", 60),
                                              "quiet",
                                            )
                                          : null,
                                        b.timer?.endsAt || timerSeconds
                                          ? button(
                                              "Clear",
                                              tool("stop"),
                                              "quiet",
                                            )
                                          : null,
                                      ],
                                    )
                                  : null,
                              ],
                            )
                          : null,
                        admin && !m.toolsOpen && b.phase !== "closed"
                          ? h.div(
                              [
                                h.Class(
                                  `room-tools-toggle ${admin && canCombine && b.canUndoCombine ? "has-undo" : ""}`,
                                ),
                              ],
                              [
                                button(
                                  m.toolsOpen
                                    ? "Close room controls"
                                    : "Facilitator controls",
                                  Message.Tools(),
                                  "quiet",
                                  false,
                                  "gear",
                                ),
                              ],
                            )
                          : null,
                      ],
                    ),
                    m.toolsOpen && b.phase !== "closed"
                      ? h.div(
                          [h.Class("controls-close")],
                          [
                            button(
                              "Close controls",
                              Message.Tools(),
                              "quiet",
                              false,
                              "x",
                            ),
                          ],
                        )
                      : null,
                    m.toolsOpen && admin && b.phase !== "closed"
                      ? h.section(
                          [h.Class("room-tools"), h.AriaLabel("Room controls")],
                          [
                            h.div(
                              [],
                              [
                                h.h3([], ["Hand over facilitation"]),
                                h.p(
                                  [h.Class("subtle")],
                                  [
                                    "The selected teammate gets control immediately.",
                                  ],
                                ),
                                Select.view(
                                  {
                                    id: "handover-to",
                                    value: m.handoverTo,
                                    onChange: (value) =>
                                      Message.Field({
                                        field: "handoverTo",
                                        value,
                                      }),
                                    toView: (a) =>
                                      h.div(
                                        [h.Class("field")],
                                        [
                                          h.label(
                                            [...a.label],
                                            ["Next facilitator"],
                                          ),
                                          h.select(
                                            [...a.select],
                                            [
                                              h.option(
                                                [h.Value("")],
                                                ["Choose a teammate"],
                                              ),
                                              ...b.participants
                                                .filter(
                                                  (p) => p.id !== m.actorId,
                                                )
                                                .map((p) =>
                                                  h.option(
                                                    [h.Value(p.id)],
                                                    [p.name],
                                                  ),
                                                ),
                                            ],
                                          ),
                                        ],
                                      ),
                                  },
                                  h,
                                ),
                                button(
                                  "Hand over control",
                                  tool("handover"),
                                  "secondary",
                                  !m.handoverTo,
                                ),
                              ],
                            ),
                          ],
                        )
                      : null,
                  ],
                ),
                m.invite && admin
                  ? h.section(
                      [
                        h.Class("invitations-panel"),
                        h.AriaLabel("People and invitations"),
                      ],
                      [
                        h.div(
                          [h.Class("invitation-heading")],
                          [
                            h.h2([], ["People & invites"]),
                            button(
                              "Close",
                              Message.Invite(),
                              "quiet",
                              false,
                              "x",
                            ),
                          ],
                        ),
                        m.inviteLoading
                          ? h.p([h.Role("status")], ["Loading invitations…"])
                          : null,
                        m.inviteError
                          ? h.div(
                              [h.Role("alert")],
                              [
                                m.inviteError,
                                button(
                                  "Retry invitations",
                                  Message.RetryInvites(),
                                  "secondary",
                                ),
                              ],
                            )
                          : null,
                        h.p(
                          [h.Class("subtle")],
                          [
                            "Each person gets their own link. Share the room password separately.",
                          ],
                        ),
                        h.form(
                          [
                            h.Class("invitation-form"),
                            h.OnSubmit(Message.AddInvite()),
                          ],
                          [
                            field(
                              "inviteName",
                              "Participant name",
                              m.inviteName,
                              "e.g. Sam",
                            ),
                            button(
                              "Add participant",
                              Message.AddInvite(),
                              "primary",
                              !m.inviteName.trim() ||
                                m.busy ||
                                b.phase === "closed",
                              "user-plus",
                            ),
                          ],
                        ),
                        ...m.inviteLinks.map((p) =>
                          h.div(
                            [h.Class("invitation-row"), h.Key(p.id)],
                            [
                              h.div(
                                [],
                                [
                                  h.strong(
                                    [],
                                    [
                                      p.name +
                                        (p.id === m.actorId ? " (you)" : ""),
                                    ],
                                  ),
                                  h.span(
                                    [h.Class("subtle")],
                                    [
                                      b.participants.some(
                                        (person) => person.id === p.id,
                                      )
                                        ? "Joined"
                                        : "Invited",
                                    ],
                                  ),
                                ],
                              ),
                              Input.view(
                                {
                                  id: `invite-${p.id}`,
                                  value: p.url,
                                  isReadOnly: true,
                                  toView: (a) =>
                                    h.input([
                                      ...a.input,
                                      h.AriaLabel(
                                        `Personal link for ${p.name}`,
                                      ),
                                    ]),
                                },
                                h,
                              ),
                              h.button(
                                [
                                  h.Type("button"),
                                  h.Class("button secondary invite-copy"),
                                  h.AriaLabel(`Copy link for ${p.name}`),
                                  h.OnClick(Message.Copy({ url: p.url })),
                                ],
                                [icon("copy"), h.span([], ["Copy link"])],
                              ),
                            ],
                          ),
                        ),
                      ],
                    )
                  : null,

                (b.phase === "actions" || b.phase === "closed") &&
                (m.mobileMenu || m.invite || m.toolsOpen)
                  ? h.div(
                      [h.Class("room-sheet-export")],
                      [
                        button(
                          "Export",
                          Message.Export(),
                          "secondary",
                          false,
                          "download-simple",
                        ),
                      ],
                    )
                  : null,
              ],
            ),
            b.phase === "closed"
              ? h.section(
                  [h.Class("closed-summary")],
                  [
                    icon("check-circle"),
                    h.div(
                      [],
                      [
                        h.h1(
                          [],
                          [
                            b.archived
                              ? "Archived · read-only"
                              : "Retrospective complete",
                          ],
                        ),
                        h.p(
                          [h.Class("muted")],
                          [
                            `Download before ${new Date(b.deletesAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}. This retro is then deleted automatically.`,
                          ],
                        ),
                        h.a(
                          [h.Href("/"), h.Class("home-link")],
                          ["Back to retrospectives", icon("arrow-right")],
                        ),
                        button(
                          `${b.actions.length} action ${b.actions.length === 1 ? "item" : "items"}${m.actionsOnly ? " · filtered" : ""}`,
                          Message.ToggleActions(),
                          "quiet action-count",
                          !b.actions.length,
                          "funnel",
                        ),
                      ],
                    ),
                    button(
                      "Download summary",
                      Message.Export(),
                      "primary",
                      false,
                      "download-simple",
                    ),
                    admin
                      ? button(
                          "Manage room",
                          Message.ManageRoom(),
                          "secondary",
                          false,
                          "gear",
                        )
                      : null,
                    admin && m.manageRoom
                      ? h.div(
                          [h.Class("cleanup-actions")],
                          [
                            button(
                              b.archived ? "Restore retro" : "Archive retro",
                              run(b.archived ? "restore" : "archive"),
                              "secondary",
                              m.busy,
                              "archive",
                            ),
                            h.p(
                              [h.Class("subtle")],
                              [
                                b.archived
                                  ? "Read-only until restored."
                                  : "Archiving makes the room read-only. You can restore it later.",
                              ],
                            ),
                            button(
                              "Delete retro…",
                              Message.Cleanup(),
                              "secondary",
                              m.busy,
                              "trash",
                            ),
                            m.cleanup
                              ? h.section(
                                  [
                                    h.Class("cleanup-confirm"),
                                    h.AriaLabel("Delete retro permanently"),
                                  ],
                                  [
                                    h.h3(
                                      [],
                                      ["Permanently delete this retro?"],
                                    ),
                                    h.p(
                                      [],
                                      [
                                        "This removes all notes, votes and actions for everyone. The room link will stop working. There is no undo.",
                                      ],
                                    ),
                                    h.p(
                                      [],
                                      [
                                        "Download the summary first and check that the file is saved before continuing.",
                                      ],
                                    ),
                                    button(
                                      "Download summary",
                                      Message.Export(),
                                      "secondary",
                                      false,
                                      "download-simple",
                                    ),
                                    field(
                                      "deleteTitle",
                                      `Type “${b.title}” to confirm`,
                                      m.deleteTitle,
                                    ),
                                    button(
                                      m.busy
                                        ? "Deleting…"
                                        : "Permanently delete",
                                      Message.DeleteRoom(),
                                      "danger",
                                      m.busy || m.deleteTitle !== b.title,
                                      "trash",
                                    ),
                                    button(
                                      "Cancel",
                                      Message.Cleanup(),
                                      "secondary",
                                      m.busy,
                                    ),
                                  ],
                                )
                              : null,
                          ],
                        )
                      : null,
                  ],
                )
              : null,
            feedback(),
            b.phase === "vote"
              ? h.p(
                  [h.Class("voting-progress"), h.Role("status")],
                  [
                    availableVotes(b) === 0
                      ? "There are no notes to vote on."
                      : `${b.voters.length} of ${b.participants.length} people have finished voting`,
                  ],
                )
              : null,
            !m.connected
              ? button(
                  "Reconnect",
                  Message.Retry(),
                  "secondary",
                  false,
                  "arrows-clockwise",
                )
              : null,
            h.div(
              [h.Class("board-navigation")],
              [
                resultsVisible && m.actionsOnly
                  ? button(
                      "Show all notes",
                      Message.ToggleActions(),
                      "secondary action-filter-reset",
                      Boolean(selected),
                      "x",
                    )
                  : null,
                resultsVisible
                  ? Select.view(
                      {
                        id: "vote-sort",
                        value: m.voteSort,
                        onChange: (value) =>
                          Message.VoteSort({
                            order: Match.value(value).pipe(
                              Match.when("lowest", () => "lowest" as const),
                              Match.when("original", () => "original" as const),
                              Match.orElse(() => "highest" as const),
                            ),
                          }),
                        toView: (a) =>
                          h.div(
                            [h.Class("sort-control")],
                            [
                              h.label([...a.label], ["Sort by"]),
                              icon("sort-descending"),
                              h.select(
                                [...a.select],
                                [
                                  h.option(
                                    [h.Value("highest")],
                                    ["Most votes first"],
                                  ),
                                  h.option(
                                    [h.Value("lowest")],
                                    ["Fewest votes first"],
                                  ),
                                  h.option(
                                    [h.Value("original")],
                                    ["Original order"],
                                  ),
                                ],
                              ),
                            ],
                          ),
                      },
                      h,
                    )
                  : null,
                m.screen === "board"
                  ? h.nav(
                      [h.Class("column-tabs"), h.AriaLabel("Note columns")],
                      columns.map((c) =>
                        h.button(
                          [
                            h.Class(
                              `${c.tone} ${m.mobileColumn === c.id ? "active" : ""}`,
                            ),
                            h.OnClick(Message.MobileColumn({ column: c.id })),
                            h.AriaPressed(String(m.mobileColumn === c.id)),
                          ],
                          [
                            icon(c.icon),
                            c.title,
                            h.span([], [String(columnCount(c.id))]),
                          ],
                        ),
                      ),
                    )
                  : null,
              ],
            ),
            h.div(
              [h.Class(`board category-${m.categoryDirection}`)],
              columns.map((c) => {
                const notes = sortByVotes(
                  visibleNotes.filter((n) => n.column === c.id),
                  resultsVisible ? m.voteSort : "original",
                  (n) => score(n.id),
                );

                const hidden = Math.max(0, (b.tally[c.id] ?? 0) - notes.length);

                return h.keyed("section")(
                  c.id,
                  [
                    h.Class(
                      `column ${c.tone} ${m.mobileColumn === c.id ? "mobile-active" : ""}`,
                    ),
                    h.AriaLabel(c.title),
                  ],
                  [
                    h.div(
                      [h.Class("column-header")],
                      [
                        h.div(
                          [h.Class("column-title")],
                          [
                            h.h2([], [icon(c.icon), c.title]),
                            h.span(
                              [h.Class("count")],
                              [String(columnCount(c.id))],
                            ),
                          ],
                        ),
                        writing
                          ? h.h1(
                              [h.Class("mobile-composer-heading")],
                              [
                                h.span(
                                  [h.Class("category-stamp")],
                                  [icon(c.icon)],
                                ),
                                h.span(
                                  [],
                                  [writingPrompts.get(c.title) ?? c.title],
                                ),
                              ],
                            )
                          : null,
                        writing ? h.p([], [c.description]) : null,
                      ],
                    ),
                    writing &&
                    !me?.ready &&
                    (m.editor === c.id ||
                      (!m.editor && m.mobileColumn === c.id))
                      ? h.form(
                          [
                            h.Class(
                              `note-editor ${!m.editor ? "automatic-composer" : ""}`,
                            ),
                            h.OnSubmit(run("save")),
                          ],
                          [
                            h.div(
                              [h.Class("composer-sheet")],
                              [
                                h.span(
                                  [h.Class("composer-icon")],
                                  [icon(c.icon)],
                                ),
                                textarea(
                                  "draft",
                                  `Your ${c.title} note`,
                                  m.draft,
                                  "What’s on your mind?",
                                ),
                              ],
                            ),
                            h.div(
                              [h.Class("editor-actions")],
                              [
                                h.p(
                                  [h.Class("composer-privacy")],
                                  [icon("lock-simple"), "Private until reveal"],
                                ),
                                m.editId || m.draft
                                  ? button(
                                      "Cancel",
                                      Message.CancelEdit(),
                                      "quiet",
                                    )
                                  : null,
                                m.editId
                                  ? button(
                                      "Delete",
                                      run("delete", m.editId),
                                      "danger-quiet",
                                      false,
                                      "trash",
                                    )
                                  : null,
                                button(
                                  m.busy
                                    ? "Saving…"
                                    : m.editId
                                      ? "Save changes"
                                      : "Add note",
                                  run("save"),
                                  "primary",
                                  !m.draft.trim(),
                                  m.editId ? "check" : "plus",
                                ),
                              ],
                            ),
                          ],
                        )
                      : writing && !me?.ready
                        ? button(
                            "Add a note",
                            Message.MobileColumn({ column: c.id }),
                            "add-note",
                            false,
                            "plus",
                          )
                        : null,
                    h.div(
                      [h.Class("notes")],
                      [
                        ...notes.map((n) =>
                          h.article(
                            [
                              h.Class(
                                `note ${m.selected === n.id ? "selected" : ""} ${m.dragSource === n.id ? "is-dragging" : ""} ${m.dropTarget === n.id ? "drop-target" : ""}`,
                              ),
                              h.Key(n.id),
                              h.Id(`note-${n.id}`),
                              ...(canCombine && !m.busy
                                ? [
                                    h.Draggable(true),
                                    h.Tabindex(0),
                                    h.AriaLabel(
                                      `${n.text}. Press Space to pick up, arrow keys to choose a destination, Enter to combine, Escape to cancel.`,
                                    ),
                                    h.OnDragStart(
                                      Message.DragStart({ id: n.id }),
                                    ),
                                    h.OnDragEnd(Message.DragEnd()),
                                    h.AllowDrop(),
                                    h.OnDragEnter(
                                      Message.DragOver({ id: n.id }),
                                    ),
                                    h.OnDragOver(
                                      Message.DragOver({ id: n.id }),
                                    ),
                                    h.OnDragLeave(Message.DragOver({ id: "" })),
                                    h.OnDrop(Message.Drop({ id: n.id })),
                                  ]
                                : []),
                            ],
                            [
                              ...(n.parts
                                ? n.parts.map((part) =>
                                    h.div(
                                      [h.Class("combined-part")],
                                      [
                                        h.p(
                                          [h.Class("note-text")],
                                          [part.text],
                                        ),
                                        h.span(
                                          [h.Class("subtle")],
                                          [
                                            b.participants.find(
                                              (p) => p.id === part.authorId,
                                            )?.name ?? "Teammate",
                                          ],
                                        ),
                                      ],
                                    ),
                                  )
                                : [h.p([h.Class("note-text")], [n.text])]),
                              h.div(
                                [h.Class("note-footer")],
                                [
                                  writing
                                    ? null
                                    : h.span(
                                        [h.Class("subtle")],
                                        [
                                          n.parts
                                            ? `${n.parts.length} combined notes`
                                            : (b.participants.find(
                                                (p) => p.id === n.authorId,
                                              )?.name ?? "Teammate"),
                                        ],
                                      ),
                                  writing && !me?.ready
                                    ? button(
                                        "Edit",
                                        Message.Edit({
                                          column: c.id,
                                          id: n.id,
                                          text: n.text,
                                        }),
                                        "icon-button",
                                        false,
                                        "pencil-simple",
                                      )
                                    : null,
                                  b.phase === "vote"
                                    ? h.button(
                                        [
                                          h.Class(
                                            `button vote ${m.private.votes.includes(n.id) ? "selected-vote" : ""}`,
                                          ),
                                          h.AriaPressed(
                                            String(
                                              m.private.votes.includes(n.id),
                                            ),
                                          ),
                                          h.AriaLabel(
                                            `${m.private.votes.includes(n.id) ? "Remove vote from" : "Vote for"}: ${n.text}`,
                                          ),
                                          h.Disabled(
                                            !m.private.votes.includes(n.id) &&
                                              m.private.votes.length >=
                                                availableVotes(b),
                                          ),
                                          h.AriaBusy(m.pendingVote === n.id),
                                          h.OnClick(
                                            run(
                                              "vote",
                                              n.id,
                                              !m.private.votes.includes(n.id),
                                            ),
                                          ),
                                        ],
                                        [
                                          icon(
                                            m.private.votes.includes(n.id)
                                              ? "check"
                                              : "plus",
                                          ),
                                          m.pendingVote === n.id
                                            ? "Saving…"
                                            : m.private.votes.includes(n.id)
                                              ? "Voted"
                                              : "Vote",
                                        ],
                                      )
                                    : null,
                                  b.phase === "actions" || b.phase === "closed"
                                    ? h.span(
                                        [h.Class("vote-score")],
                                        [
                                          icon("hand-pointing"),
                                          `${score(n.id)} ${score(n.id) === 1 ? "vote" : "votes"}`,
                                        ],
                                      )
                                    : null,
                                  admin &&
                                  b.phase === "actions" &&
                                  m.selected !== n.id
                                    ? button(
                                        "Add action",
                                        Message.Select({ id: n.id }),
                                        "icon-button",
                                        false,
                                        "list-plus",
                                      )
                                    : null,
                                ],
                              ),
                              canCombine && n.parts
                                ? button(
                                    "Split notes",
                                    Message.Split({ id: n.id }),
                                    "icon-button",
                                    m.busy,
                                    "arrows-out",
                                  )
                                : null,
                              ...b.actions
                                .filter((a) => a.noteId === n.id)
                                .map((a) =>
                                  m.actionId === a.id && admin
                                    ? actionForm
                                    : h.div(
                                        [h.Class("card-action"), h.Key(a.id)],
                                        [
                                          h.div(
                                            [],
                                            [
                                              h.strong([], [a.text]),
                                              h.p(
                                                [h.Class("subtle")],
                                                [
                                                  b.participants.find(
                                                    (p) => p.id === a.ownerId,
                                                  )?.name ?? "Unassigned",
                                                  a.dueDate
                                                    ? ` · ${new Date(a.dueDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
                                                    : "",
                                                ],
                                              ),
                                            ],
                                          ),
                                          admin && b.phase === "actions"
                                            ? h.div(
                                                [h.Class("action-controls")],
                                                [
                                                  button(
                                                    "Edit action",
                                                    Message.EditAction({
                                                      id: a.id,
                                                    }),
                                                    "icon-button",
                                                    m.busy,
                                                    "pencil-simple",
                                                  ),
                                                  button(
                                                    "Delete action",
                                                    run("deleteAction", a.id),
                                                    "icon-button",
                                                    m.busy,
                                                    "trash",
                                                  ),
                                                ],
                                              )
                                            : null,
                                        ],
                                      ),
                                ),
                              m.selected === n.id && !m.actionId
                                ? actionForm
                                : null,
                            ],
                          ),
                        ),
                        writing && hidden > 0
                          ? h.div(
                              [h.Class("hidden-notes")],
                              [
                                icon("lock-simple"),
                                `${hidden} private ${hidden === 1 ? "note" : "notes"} from others`,
                              ],
                            )
                          : null,
                        !notes.length && !writing
                          ? h.p(
                              [h.Class("empty-column")],
                              [
                                m.actionsOnly
                                  ? "No actions in this category"
                                  : "No notes",
                              ],
                            )
                          : null,
                      ],
                    ),
                  ],
                );
              }),
            ),
          ],
        ),
        h.footer(
          [h.Class("session-footer")],
          [
            h.div(
              [h.Class("footer-summary")],
              [
                b.phase === "actions"
                  ? button(
                      `${b.actions.length} action ${b.actions.length === 1 ? "item" : "items"}${m.actionsOnly ? " · filtered" : ""}`,
                      Message.ToggleActions(),
                      "quiet action-count",
                      Boolean(selected) || !b.actions.length,
                      "funnel",
                    )
                  : h.strong(
                      [],
                      [
                        writing
                          ? `${ready} of ${b.participants.length} ready`
                          : b.phase === "vote"
                            ? `${m.private.votes.length} of ${availableVotes(b)} votes used`
                            : b.phase === "closed"
                              ? b.archived
                                ? "Archived · read-only"
                                : "Session complete"
                              : "All notes revealed",
                      ],
                    ),
              ],
            ),
            writing
              ? h.div(
                  [h.Class("ready-people")],
                  b.participants
                    .slice(0, 6)
                    .map((p, i) =>
                      h.div(
                        [h.Class("ready-person")],
                        [
                          avatar(p, i),
                          h.span(
                            [h.Class(p.ready ? "ready-label" : "subtle")],
                            [p.ready ? "Ready" : "Writing"],
                          ),
                        ],
                      ),
                    ),
                )
              : h.div([h.Class("footer-spacer")]),
            h.div(
              [h.Class("footer-actions")],
              [
                writing
                  ? button(
                      me?.ready ? "Keep writing" : "Done writing",
                      run("ready", "", !me?.ready),
                      "secondary",
                      Boolean(m.draft.trim()) ||
                        Object.values(m.drafts).some((draft) => draft.trim()),
                      "check",
                    )
                  : null,
                b.phase === "vote"
                  ? button(
                      b.voters.includes(m.actorId)
                        ? "Change votes"
                        : "Done voting",
                      run("votingDone", "", !b.voters.includes(m.actorId)),
                      "secondary",
                      m.busy,
                      "check",
                    )
                  : null,
                admin && primary
                  ? button(
                      primary.label,
                      Message.Confirm({ op: primary.op }),
                      "primary",
                      m.busy || Boolean(selected),
                      primary.icon,
                    )
                  : null,
              ],
            ),
          ],
        ),
        m.confirm && primary && !(b.phase === "actions" && selected)
          ? h.div(
              [
                h.Class("confirm-bar"),
                h.Role("region"),
                h.AriaLabel("Confirm next phase"),
              ],
              [
                h.div(
                  [],
                  [
                    h.strong([], [primary.label + "?"]),
                    h.p([], [phaseConfirmation(b, m.confirm)]),
                  ],
                ),
                button("Not yet", Message.Confirm({ op: "" }), "secondary"),
                button(primary.label, run(primary.op), "primary"),
              ],
            )
          : null,
      ],
    ),
  };
});
