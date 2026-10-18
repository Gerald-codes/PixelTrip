# Requirements Document

## Introduction

This document specifies the requirements for the **Project Foundation** of PixelArt Trip
Planner. The foundation is **scaffolding only**: it establishes a monorepo with three
independently deployable parts — a Next.js + React + TypeScript + Tailwind frontend, a
FastAPI + Python backend placeholder, and a shared documentation structure — so that three
team members (one frontend developer, two backend developers) can work in parallel without
blocking one another.

The defining architectural decision is a **contract-first service layer** in the frontend.
Because frontend and backend are built simultaneously, the UI depends only on typed service
interfaces whose shapes are dictated by `api-contracts.md` (the single source of truth). Two
implementations exist behind a single selection point chosen by an environment flag: **mock
services** for independent frontend development, and **backend API services** for later
integration. Switching from mock to real is a configuration change, never a UI change.

These requirements are derived from the approved design document
(`.kiro/specs/01-project-foundation/design.md`) and the project steering
(`product.md`, `frontend-architecture.md`, `development-rules.md`, `api-contracts.md`,
`pixel-design-system.md`). They deliberately include **scope guards** (no business logic, no
AI, no real Supabase features, no auth) as explicit, verifiable requirements. No business
logic, AI orchestration, real Supabase features, or authentication are implemented at this
stage.

## Glossary

- **Foundation**: The scaffolding deliverable defined by this spec (monorepo structure,
  frontend/backend scaffolds, service layer contracts, docs). Contains no business logic.
- **Monorepo**: The single repository root `PixelArt-Trip-Planner/` containing `frontend/`,
  `backend/`, and `docs/` plus root-level configuration files.
- **Frontend_App**: The Next.js (App Router) + React + TypeScript + Tailwind application under
  `frontend/`.
- **Backend_App**: The FastAPI + Python application placeholder under `backend/`.
- **Service_Interface**: A TypeScript type/contract in the frontend service layer whose method
  signatures and returned shapes mirror `api-contracts.md`.
- **Service_Selector**: The single function (`getServices()` in `src/services/index.ts`) that
  returns either the mock or the real implementation set based on an environment flag.
- **Service_Mode**: The value of the environment variable `NEXT_PUBLIC_SERVICE_MODE`; one of
  `"mock"` or `"real"`, defaulting to `"mock"` when unset.
- **Mock_Service**: An in-memory implementation of a Service_Interface that returns
  contract-shaped fixture data, enabling frontend development with no backend.
- **Real_Service**: A placeholder implementation of a Service_Interface intended to call
  Supabase/FastAPI; in the Foundation it raises `NotImplementedError`.
- **Service_Registry**: The object returned by the Service_Selector containing every service
  (`guest`, `room`, `chat`, `vote`, `itinerary`) for the selected Service_Mode.
- **Design_Token**: A named theme value (color role, spacing unit, font, image-rendering
  setting) defined in `tailwind.config.ts` per `pixel-design-system.md`.
- **Placeholder_Primitive**: A typed shell component under `src/components` (e.g. `PixelButton`,
  `PixelCard`, `DialogueBox`) reserved for later implementation, not fully implemented here.
- **Guest_Model**: The no-auth identity model where a user is a display name plus a
  client-generated UUID, with no email, password, or tokens.
- **Contract**: The agreed data shapes documented in `api-contracts.md`, the single source of
  truth for all frontend/backend data shapes.
- **Health_Endpoint**: The `GET /health` route on the Backend_App returning `{"status": "ok"}`.
- **Supabase_Ownership_Split**: The boundary where the Frontend_App owns anon-key client
  integration (placeholder only in the Foundation) and the Backend_App owns privileged
  service-role access and AI-related data workflows; `api-contracts.md` remains the single
  source of truth for shared data shapes.

## Requirements

### Requirement 1: Monorepo Repository Structure

**User Story:** As a team member, I want a defined monorepo structure with root configuration
files, so that all three developers share one consistent repository layout.

#### Acceptance Criteria

1. THE Foundation SHALL provide a repository root containing a `frontend/` directory, a
   `backend/` directory, and a `docs/` directory, each present at the top level of the
   repository root.
2. THE Foundation SHALL provide a root `README.md` file that contains a project description
   section, a section describing how to run the `frontend/` part, and a section describing how
   to run the `backend/` part.
3. THE Foundation SHALL provide a root `.gitignore` file that lists ignore entries for
   dependency directories, build output, and environment files (`.env`) while excluding
   `.env.example` files from being ignored.
4. THE Foundation SHALL provide a root `.env.example` file that references the
   `frontend/.env.example` file and the `backend/.env.example` file by their relative paths.
5. THE Foundation SHALL provide a `.env.example` file located in the `frontend/` directory and
   a `.env.example` file located in the `backend/` directory.
6. WHEN a developer clones the repository, THE Foundation SHALL contain no committed `.env` file
   in the repository root, in `frontend/`, or in `backend/`.

### Requirement 2: Frontend Scaffold and Folder Conventions

**User Story:** As the frontend developer, I want a Next.js + TypeScript + Tailwind scaffold
following the agreed folder conventions, so that I can build features in a consistent structure.

#### Acceptance Criteria

1. THE Frontend_App SHALL be a Next.js application configured to use the App Router with React
   and TypeScript as the language for all application source files.
2. THE Frontend_App SHALL set the TypeScript `strict` compiler option to `true` in
   `tsconfig.json`.
3. THE Frontend_App SHALL configure Tailwind CSS as the styling system such that Tailwind
   utility classes applied in a component produce their corresponding styles when the
   application is built.
4. THE Frontend_App SHALL provide all six of the directories `src/features`, `src/components`,
   `src/hooks`, `src/lib`, `src/services`, and `src/types` as described in
   `frontend-architecture.md`.
5. THE Frontend_App SHALL provide a `src/mocks` directory for mock fixture data.
6. THE Frontend_App SHALL provide feature-module folders under `src/features` that map
   one-to-one to the six user-journey stages, named `setup`, `discover`, `logistics`, `build`,
   `refine`, and `wrap`, plus the shared `party-room` folder.
7. THE Frontend_App SHALL leave each `src/features` stage folder without feature business logic
   in the Foundation.
8. THE Frontend_App SHALL provide the App Router entry files `app/layout.tsx`, `app/page.tsx`,
   and `app/globals.css`.
9. THE Frontend_App SHALL keep each App Router entry file limited to layout, routing, and
   composition of feature components, containing no business logic (no data transformation, no
   API or service calls, and no state management beyond composition).
10. IF the project build or type-check is run and the `strict` compiler option is not enabled or
    any of the required `src` directories or App Router entry files are absent, THEN THE
    Frontend_App SHALL fail the build with an error indicating the missing configuration or path.

### Requirement 3: Pixel Design Token Foundation

**User Story:** As the frontend developer, I want the pixel design tokens established from day
one, so that styling stays consistent and no feature invents raw values.

#### Acceptance Criteria

1. THE Frontend_App SHALL define color-role Design_Tokens for the following ten roles in
   `tailwind.config.ts`: bg, bg-alt, ink, primary, primary-dark, accent, success, warning,
   danger, and muted, where each role maps to exactly one color value.
2. THE Frontend_App SHALL define a spacing scale in `tailwind.config.ts` composed exclusively of
   8px multiples, including the values 8px, 16px, 24px, and 32px.
3. THE Frontend_App SHALL define two font-role Design_Tokens in `tailwind.config.ts`: a display
   role using a pixel/bitmap font and a body role using a body font.
4. THE Frontend_App SHALL expose a pixelated image-rendering utility via `tailwind.config.ts`
   that sets image rendering to the pixelated mode.
5. THE Frontend_App SHALL provide Placeholder_Primitive shells for exactly five components under
   `src/components`: PixelButton, PixelCard, DialogueBox, ChatBubble, and CharacterSprite.
6. WHEN a Placeholder_Primitive shell is compiled under TypeScript strict mode, THE Frontend_App
   SHALL export typed props for it and SHALL compile with zero type errors.
7. WHEN a Placeholder_Primitive shell is rendered, THE Frontend_App SHALL produce minimal or no
   visible output and SHALL NOT contain a full feature implementation.
8. IF a component applies a color, spacing, or font value that is a raw hex code or an
   arbitrary/non-token value, THEN THE Frontend_App build tooling SHALL reject the value and
   SHALL indicate an error identifying the disallowed value.

### Requirement 4: Backend Scaffold and Health Endpoint

**User Story:** As a backend developer, I want a FastAPI placeholder with a Python environment
and a health check, so that I can extend it and verify it runs.

#### Acceptance Criteria

1. THE Backend_App SHALL be a FastAPI application that includes a Python dependency manifest
   declaring FastAPI and its runtime server, and a tooling configuration file, both located at
   the backend project root.
2. THE Backend_App SHALL expose a Health_Endpoint that accepts the `GET /health` request.
3. WHEN a `GET /health` request is received, THE Backend_App SHALL respond within 1000
   milliseconds with a success status and the exact JSON body `{"status": "ok"}`.
4. IF a request using any HTTP method other than GET is received at `/health`, THEN THE
   Backend_App SHALL reject the request with a client-error status indicating the method is not
   allowed and SHALL NOT return the `{"status": "ok"}` body.
5. THE Backend_App SHALL provide a smoke test that issues a `GET /health` request and asserts
   both a success status and the exact JSON body `{"status": "ok"}`, failing otherwise.
6. THE Backend_App SHALL reserve an `app/schemas` location for models mirroring the Contract,
   containing no implemented models during the Foundation phase.

### Requirement 5: Contract-First Service Interfaces

**User Story:** As the frontend developer, I want typed service interfaces derived from the
contract, so that the UI depends only on agreed shapes and integrates cleanly with the backend.

#### Acceptance Criteria

1. THE Frontend_App SHALL define exactly five Service_Interface definitions, one per Contract
   domain — `guest`, `room`, `chat`, `vote`, and `itinerary` — with no additional
   Service_Interface for a domain absent from `api-contracts.md`.
2. THE Frontend_App SHALL type every Service_Interface method parameter and return value using a
   named type imported from `src/types`, with no inline anonymous object types and no `any` in
   any Service_Interface signature.
3. WHERE `api-contracts.md` defines a data shape, THE Frontend_App SHALL define a corresponding
   `src/types` type whose properties include every field named in that shape and exclude any
   field not named in that shape or in another referenced contract shape.
4. WHERE `api-contracts.md` marks a field optional (`?`), THE Frontend_App SHALL declare the
   corresponding `src/types` property as optional, and SHALL declare all other contract fields
   as required.
5. WHERE a contract field is described as an id or a timestamp, THE Frontend_App SHALL type it
   as a string in the corresponding `src/types` type.
6. THE Service_Interface public surface SHALL expose only types declared in `src/types` and
   SHALL exclude Supabase-specific and FastAPI-specific types from every exported method
   signature and returned shape.
7. THE Service_Interface definitions SHALL declare method signatures only and SHALL contain no
   feature or business logic; behavior is supplied solely by the Mock_Service (contract-shaped
   fixture data) or the Real_Service (which raises `NotImplementedError` in the Foundation).

### Requirement 6: Single Implementation Selector

**User Story:** As the frontend developer, I want one place that selects mock or real services
via an environment flag, so that switching backends is a configuration change.

#### Acceptance Criteria

1. THE Service_Selector SHALL read the Service_Mode from the environment variable
   `NEXT_PUBLIC_SERVICE_MODE`.
2. WHEN `NEXT_PUBLIC_SERVICE_MODE` is unset, empty, or whitespace-only, THE Service_Selector
   SHALL default the Service_Mode to `"mock"`.
3. WHEN the Service_Mode equals `"mock"` by exact, case-sensitive comparison, THE
   Service_Selector SHALL return a Service_Registry of Mock_Service implementations.
4. WHEN the Service_Mode equals `"real"` by exact, case-sensitive comparison, THE
   Service_Selector SHALL return a Service_Registry of Real_Service implementations.
5. IF the Service_Mode is any value other than `"mock"` or `"real"`, THEN THE Service_Selector
   SHALL raise a configuration error at selection time that identifies the invalid value and the
   variable name, and SHALL NOT return a Service_Registry.
6. THE Service_Selector SHALL return a Service_Registry whose members expose the identical
   Service_Interface set with the same member keys regardless of the selected Service_Mode.
7. THE Service_Selector SHALL be the only location in the Frontend_App where a concrete
   Mock_Service or Real_Service implementation is chosen.

### Requirement 7: Mock and Real Implementation Scaffolds

**User Story:** As the frontend developer, I want mock services that return contract-shaped data
and real placeholders that fail loudly, so that I can build the UI now and integrate later.

#### Acceptance Criteria

1. THE Frontend_App SHALL provide a Mock_Service implementation for every method declared in
   each Service_Interface, such that the count of implemented mock methods equals the count of
   declared interface methods and no interface method is left unimplemented.
2. WHEN a Mock_Service method is invoked, THE Mock_Service SHALL return fixture data whose field
   names and value types match the corresponding shape in `api-contracts.md`, with no missing
   required fields and no fields absent from the Contract.
3. WHEN a Mock_Service realtime subscription method is invoked, THE Mock_Service SHALL return an
   unsubscribe function.
4. WHEN a Mock_Service-provided unsubscribe function is invoked, THE Mock_Service SHALL deliver
   zero further subscription callbacks after the invocation returns.
5. IF a Real_Service method is called during the Foundation phase, THEN THE Real_Service SHALL
   raise a `NotImplementedError` and SHALL NOT return a value or perform any Supabase or FastAPI
   access.
6. THE Frontend_App SHALL confine all Supabase and FastAPI access to the service layer, and
   SHALL contain zero such calls in files under `app/`, `src/features`, or `src/components`.
7. WHEN the Service_Mode is switched from `"mock"` to `"real"`, THE Frontend_App SHALL require
   zero edits to any file under `app/`, `src/features`, or `src/components`.

### Requirement 8: Independent Deployability

**User Story:** As a team member, I want each part to build and run on its own, so that neither
side waits on the other.

#### Acceptance Criteria

1. WHILE the Service_Mode is `"mock"` and no backend is reachable, THE Frontend_App SHALL
   complete its build with a success exit code and start its dev server such that the primary
   route renders without any runtime error.
2. WHILE the Service_Mode is `"mock"` and no backend is reachable, THE Frontend_App SHALL serve
   all displayed data from local mock sources and SHALL NOT emit any network request to the
   Backend_App.
3. WHILE no frontend is present, THE Backend_App SHALL complete its build with a success exit
   code and start serving requests.
4. WHILE no frontend is present, WHEN the Health_Endpoint receives a request, THE Backend_App
   SHALL return a success response indicating service liveness within 1000 milliseconds.
5. THE Frontend_App and THE Backend_App SHALL share nothing at runtime except the data shapes
   defined in the Contract.
6. IF the Frontend_App cannot reach the Backend_App WHILE the Service_Mode is `"mock"`, THEN THE
   Frontend_App SHALL continue operating from local mock sources without displaying an error
   state.

### Requirement 9: Parallel Development Support

**User Story:** As a team of three, we want the structure to support parallel work, so that the
frontend developer and two backend developers proceed without blocking.

#### Acceptance Criteria

1. THE Foundation SHALL allow the Frontend_App to build, run, and pass its test suite against
   Mock_Service implementations with no running Backend_App and no network calls to Backend_App
   endpoints.
2. THE Foundation SHALL provide a Mock_Service implementation for every operation defined in the
   Contract (`api-contracts.md`), such that the count of mocked operations equals the count of
   Contract operations.
3. THE Foundation SHALL allow the Backend_App to build, run, and pass its test suite against the
   Contract with no running Frontend_App.
4. THE Foundation SHALL confine frontend/backend coordination to the Contract layer
   (`api-contracts.md`), such that no Frontend_App source file imports or references a
   Backend_App source file and no Backend_App source file imports or references a Frontend_App
   source file.
5. IF a Frontend_App request or a Mock_Service response does not conform to the shape defined in
   the Contract (`api-contracts.md`), THEN THE Foundation SHALL surface a validation error
   identifying the non-conforming operation and SHALL NOT silently pass the mismatch.

### Requirement 10: Scope Guards and Non-Goals

**User Story:** As a team member, I want the foundation to exclude non-scaffolding concerns, so
that the foundation stays minimal and later features are not pre-empted.

#### Acceptance Criteria

1. THE Foundation SHALL exclude authentication flows, containing no email input field, no
   password input field, and no token issuance, validation, or storage logic.
2. WHERE a guest identity is created, THE Foundation SHALL represent it using only a display
   name (1 to 50 characters) and a client-generated UUID, and SHALL persist no other identity
   attributes.
3. THE Foundation SHALL exclude AI orchestration and LangGraph code, containing no LangGraph
   dependency and no AI model invocation calls.
4. THE Foundation SHALL exclude real Supabase feature calls, exposing only placeholder client
   interfaces that perform no network requests to Supabase.
5. THE Foundation SHALL exclude business logic beyond the Service_Selector and contract-shaped
   mock data, where mock data conforms to the field names and types defined in the Contract.
6. IF code outside the Service_Selector attempts to implement feature business logic, THEN THE
   Foundation SHALL treat it as out of scope and SHALL NOT include it in the foundation
   deliverable.

### Requirement 11: Documentation Structure and Steering Reconciliation

**User Story:** As a team member, I want a documentation structure and reconciled steering, so
that onboarding is clear and the mock-inclusive model is consistently described.

#### Acceptance Criteria

1. THE Foundation SHALL provide under `docs/` all four of the following documents: a
   documentation index named `README.md`, an architecture reference, a getting-started guide,
   and a contracts reference.
2. THE `docs/` documentation index (`README.md`) SHALL contain a navigable link to each of the
   other three `docs/` documents (architecture reference, getting-started guide, and contracts
   reference).
3. THE `docs/` contracts reference SHALL identify `api-contracts.md` as the single source of
   truth for API contracts and SHALL contain a navigable link to `api-contracts.md`.
4. THE Foundation SHALL reconcile `frontend-architecture.md` and `development-rules.md` so that
   both describe the mock-inclusive service model, defined as two interchangeable service
   implementations (one mock, one real) selected at exactly one point in the codebase.
5. WHILE `frontend-architecture.md` and `development-rules.md` describe the mock-inclusive
   service model, THE Foundation SHALL retain `api-contracts.md` as the single source of truth
   for API contracts, with no conflicting contract definitions in `frontend-architecture.md` or
   `development-rules.md`.
6. IF `frontend-architecture.md` or `development-rules.md` contains a service-model or contract
   statement that conflicts with `api-contracts.md`, THEN THE Foundation SHALL resolve the
   conflict in favor of `api-contracts.md` such that no contradictory statement remains.

### Requirement 12: Secrets Hygiene

**User Story:** As a team member, I want secrets kept out of version control, so that no
credentials are committed.

#### Acceptance Criteria

1. THE Foundation SHALL commit environment example files only in the form of `.env.example`
   files whose values are placeholder, non-real values (e.g. `YOUR_KEY_HERE`), and SHALL NOT
   commit any `.env` file or local `.env*` variant (such as `.env`, `.env.local`,
   `.env.development`, `.env.production`).
2. THE `.gitignore` SHALL contain patterns that exclude `.env` and all local `.env*` variants
   from version control while explicitly not ignoring `.env.example`.
3. WHEN a contributor attempts to stage a file matching an ignored `.env` or local `.env*`
   pattern, THE Foundation SHALL keep that file untracked so it is not added to version control.
4. THE Frontend_App SHALL exclude the Supabase service key from all committed and bundled files,
   and the Supabase service key SHALL be reserved for the Backend_App/service role only.
5. IF a committed file contains a real credential value (any non-placeholder secret, key, token,
   or password), THEN THE Foundation SHALL be considered non-compliant, and the file SHALL be
   treated as a violation requiring removal before merge.

### Requirement 13: Supabase Ownership Boundary

**User Story:** As a team, we want the Supabase ownership split defined, so that frontend and
backend do not duplicate or collide on data access.

#### Acceptance Criteria

1. THE Frontend_App SHALL own Supabase client integration where appropriate, exposing only a
   placeholder Supabase client (anon-key oriented) that performs no network requests in the
   Foundation.
2. THE Backend_App SHALL own privileged Supabase operations (service-role/service-key access)
   and AI-related data workflows, and THE Frontend_App SHALL NOT contain the Supabase service
   key or perform privileged operations.
3. WHERE a data operation requires privileged access or AI-related processing, THE Foundation
   SHALL assign it to the Backend_App boundary, not the Frontend_App.
4. THE Foundation SHALL implement no real Supabase feature calls on either side in this phase,
   providing only placeholder clients and reserved locations.
