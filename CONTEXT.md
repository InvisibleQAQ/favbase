# Favbase Collection Context

Favbase stores favorites from multiple platforms as one searchable local collection.
This context defines product language shared by collection and analytics features.

## Language

**Collection Item**:
One persisted favorite, bookmark, video, repository, answer, article, or post from a supported platform.
_Avoid_: Task, job, record

**Collection Analytics**:
Read-only aggregate facts about persisted Collection Items across supported platforms.
_Avoid_: Processing progress, job dashboard, task monitor

**Library Composition**:
The current size and categorical distribution of Collection Items, primarily by platform and tag.
_Avoid_: Processing coverage, sync throughput

**Creator**:
A platform identity responsible for a Collection Item, such as an uploader, repository owner, post author, or channel.
_Avoid_: Source, folder, playlist

**Domain**:
The website host associated with a browser bookmark and used for bookmark-specific composition.
_Avoid_: Bookmark author, creator

**Source**:
A platform container through which a Collection Item was collected, such as a favorites folder, collection, playlist, or bookmark folder.
_Avoid_: Creator, author

**Item Count**:
The number of deduplicated Collection Items; multiple Source memberships do not increase it.
_Avoid_: Membership count

**Membership Count**:
The number of Collection Item to Source relationships; one Collection Item may contribute to several Sources.
_Avoid_: Item count

**Used Tag**:
A tag linked to at least one Collection Item.
_Avoid_: Orphan tag, configured tag

**Tagged Item**:
A Collection Item linked to at least one Used Tag, regardless of how many tags it has.
_Avoid_: Tagged task, completed item

**Processing Coverage**:
A read-only, platform-scoped snapshot of how many locally persisted, eligible Collection Items have completed each content-processing stage.
It does not claim that the local collection contains every current item from the external platform.
_Avoid_: Remote sync completeness, job history, processing dashboard

**Pipeline Run**:
One bounded execution attempt for a Collection pipeline stage; its completion does not claim that local items fully cover the external platform.
_Avoid_: Processing Coverage, remote sync completeness

**Configuration Blocker**:
A platform-local processing condition where eligible Collection Items cannot enter a pipeline stage because its required provider configuration is absent.
_Avoid_: Provider failure, slow Pipeline Run, remote sync failure

**Tag Drill-down**:
Navigation from a Collection Analytics tag ranking to the aggregate collection filtered by that Used Tag.
_Avoid_: Dashboard item browser

**Dashboard**:
The default app page that presents Collection Analytics without operational task progress or controls.
_Avoid_: Processing Dashboard, queue console

**Conversation**:
One persisted Chat assistant dialogue — an ordered sequence of user, assistant, and tool turns stored as a single local database record whose model-message sequence is the source of truth; display bubbles are rebuilt from it. It is not a Collection Item.
_Avoid_: Collection Item, chat log, session cache

**Platform Request**:
An outbound guidance entry ("请求新平台 / Request a platform") that opens a prefilled new-issue form on the project repository so users can ask for an unsupported platform. It is an action link, not a platform: it never becomes a nav route, never joins the platform registry, and holds no Collection Items.
_Avoid_: Seventh platform, platform page, feedback page

**Onboarding Platform Preference**:
The canonical-order subset of supported platforms a user picks during onboarding, used only to place those platforms first in Collection navigation without changing platform availability.
_Avoid_: Enabled platforms, platform gate, click order

## Relationships

- The **Dashboard** presents **Collection Analytics**
- **Library Composition** is the primary **Collection Analytics** view
- **Collection Analytics** summarizes zero or more **Collection Items**
- A **Collection Item** belongs to exactly one supported platform
- A **Collection Item** has one **Creator** or bookmark **Domain**
- A **Collection Item** belongs to one or more **Sources** when the platform exposes containers
- A platform Collection page may present **Processing Coverage** for its locally persisted **Collection Items**
- A platform Collection page may present a **Pipeline Run** together with idle **Processing Coverage**
- A platform Collection page presents a **Configuration Blocker** only when local eligible work is waiting, not merely because a provider key is absent
- Resolving a **Configuration Blocker** resumes the affected platform's pending work in the current app-page runtime
- Each **Pipeline Run** belongs to one pipeline stage and is controlled independently; stage controls do not imply an atomic whole-pipeline operation
- Fetch, Embed, and Tags **Pipeline Runs** share one control contract across all supported Collection platforms
- A pause request lets the current **Pipeline Run** item settle, then stops before the stage claims its next item
- A paused **Pipeline Run** remains controllable across Collection route changes in the current app-page runtime, but not after that runtime closes
- A paused **Pipeline Run** remains unfinished and appears in the global do-not-close reminder until it resumes and settles
- A completed Fetch **Pipeline Run** may report 100% run completion even when remote sync completeness is unknowable
- The **Dashboard** does not present **Processing Coverage** or operational task progress
- **Library Composition** uses **Item Count** for platform share and **Membership Count** for Source rankings
- A **Tag Drill-down** leaves the **Dashboard** and opens matching **Collection Items** in the aggregate collection
- Chat reads **Collection Items** and their derived knowledge as read-only; the only records Chat writes are **Conversations**
- A **Platform Request** entry may follow the platform list in navigation or onboarding, but is visually marked as an outbound action and never participates in platform aggregation, sync, or active-route highlighting
- An **Onboarding Platform Preference** prioritizes zero or more supported platform leaves while every unselected platform remains available after them

## Example dialogue

> **Dev:** "Should the **Dashboard** show the current Embedding job and a pause button?"
> **Domain expert:** "No. The **Dashboard** summarizes stored **Collection Items**; task progress belongs elsewhere."
>
> **Dev:** "Does Fetch at 100% mean every remote favorite exists locally?"
> **Domain expert:** "No. It means that **Pipeline Run** finished; remote completeness may still be unknowable."
>
> **Dev:** "Does leaving GitHub out of the **Onboarding Platform Preference** disable GitHub Stars?"
> **Domain expert:** "No. GitHub Stars stays available; selected platforms only move ahead of it in Collection navigation."

## Flagged ambiguities

- "Progress" previously meant both a live **Pipeline Run** and idle **Processing Coverage**; these are now distinct, although a platform Collection page may combine them in one compact control.
- External platforms do not expose a durable remote-total snapshot, so **Processing Coverage** must not be described as remote sync completeness.
- "Selected platform" in onboarding previously sounded like an availability gate; it is now defined as an **Onboarding Platform Preference**, never a platform enablement setting.
- "Stuck" previously mixed missing provider configuration with slow, failed, or paused work; only missing configuration with eligible pending work is a **Configuration Blocker**.
