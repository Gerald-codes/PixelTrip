"""The agent layer: LangGraph-based NPC travel guide.

Owned by Dev C. This package holds the compiled ``Agent_Graph``, its state model,
the orchestrator and four specialist nodes, the three-layer guardrail pipeline,
and the external tool clients.

Layering rules this package obeys (Requirement 1.9-1.10, 20.1-20.2):

* Only the service layer imports it. Routes and repositories never do.
* It never constructs a repository or a Supabase client. Repositories arrive as
  arguments, bundled in a ``RepositoryBundle`` built by the service layer.
* It never becomes the source of truth for trip data. Every node re-reads current
  state from Supabase through repositories and returns proposals to be persisted.
"""
