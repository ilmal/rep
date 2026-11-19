export default function Toast({ msg, bottom = 110 }: { msg: string; bottom?: number }) {
  if (!msg) return null;
  return (
    <div className="toast" role="status" style={{ bottom }}>
      <span className="ic ic-check" aria-hidden="true" />
      <span className="grow">{msg}</span>
    </div>
  );
}
