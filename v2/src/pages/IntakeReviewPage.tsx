export function IntakeReviewPage() {
  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Canonical pipeline</p>
          <h1>Intake Review</h1>
          <p>Evidence to extraction to master resolution to validation to approval to order.</p>
        </div>
      </header>

      <div className="notice">
        V2 intake will not reuse the V1 staging endpoints. Unresolved customer or site matches will be reviewed here.
      </div>

      <div className="grid">
        <article className="card">
          <span className="metric-label">Matching</span>
          <strong className="metric">No silent guesses</strong>
        </article>
        <article className="card">
          <span className="metric-label">Evidence</span>
          <strong className="metric">Immutable</strong>
        </article>
        <article className="card">
          <span className="metric-label">Updates</span>
          <strong className="metric">Revision history</strong>
        </article>
      </div>
    </section>
  );
}
