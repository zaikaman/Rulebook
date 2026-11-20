/**
 * Indeterminate progress ring for work that is already in flight. Decorative by default: the
 * button or status line beside it carries the text, so a screen reader hears one message.
 */
export function Spinner({
  size,
  label,
}: {
  /** Diameter in pixels. Defaults to the size set by CSS for the surrounding control. */
  readonly size?: number;
  /** Set only when the spinner is the sole signal; it becomes a polite live status. */
  readonly label?: string;
}) {
  const style =
    size === undefined ? undefined : { inlineSize: `${size}px`, blockSize: `${size}px` };
  if (label) {
    return (
      <span role="status" className="rb-loading">
        <span className="rb-spinner" style={style} aria-hidden="true" />
        {label}
      </span>
    );
  }
  return <span className="rb-spinner" style={style} aria-hidden="true" />;
}
