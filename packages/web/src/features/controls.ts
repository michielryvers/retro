import { Button, Input, Textarea } from "@foldkit/ui";
import type { HtmlBuilder } from "foldkit/html";

export const controls = <Message>(h: HtmlBuilder<Message>, busy = false) => {
  const icon = (name: string) =>
    h.i([h.Class(`ph ph-${name}`), h.AriaHidden(true)]);

  const button = (
    text: string,
    message: Message,
    style = "secondary",
    disabled = false,
    glyph?: string,
  ) =>
    Button.view(
      {
        onClick: message,
        isDisabled: busy || disabled,
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
              ...(glyph ? [icon(glyph)] : []),
              ...(style === "icon-button" ? [] : [text]),
            ],
          ),
      },
      h,
    );

  const field = (
    id: string,
    label: string,
    value: string,
    onInput: (value: string) => Message,
    placeholder = "",
    type = "text",
  ) =>
    Input.view(
      {
        id,
        value,
        onInput,
        placeholder,
        type,
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label(a.label, [label]),
              h.div(
                [h.Class("input-control")],
                [h.input([...a.input, h.Disabled(busy), h.Maxlength(500)])],
              ),
            ],
          ),
      },
      h,
    );

  const textarea = (
    id: string,
    label: string,
    value: string,
    onInput: (value: string) => Message,
    placeholder: string,
    limit = 500,
  ) =>
    Textarea.view(
      {
        id,
        value,
        onInput,
        placeholder,
        rows: 3,
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label(a.label, [label]),
              h.textarea([...a.textarea, h.Maxlength(limit), h.Disabled(busy)]),
            ],
          ),
      },
      h,
    );

  return { icon, button, field, textarea };
};
