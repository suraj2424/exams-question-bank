type StateCardProps = {
  message: string;
  tone?: "loading" | "error";
};

export function StateCard({ message, tone = "loading" }: StateCardProps) {
  return (
    <section className="state-card" data-tone={tone}>
      <span className="state-card-mark" aria-hidden="true">
        {tone === "error" ? "!" : ""}
      </span>
      <p className="state-card-message" role={tone === "error" ? "alert" : undefined}>
        {message}
      </p>
    </section>
  );
}
