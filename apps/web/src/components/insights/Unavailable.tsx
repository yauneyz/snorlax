export function Unavailable({ message }: { message: string }) {
  return (
    <div className="insights-unavailable" role="status">
      <strong>Unavailable</strong>
      <span>{message}</span>
    </div>
  );
}
