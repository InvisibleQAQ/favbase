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

**Tag Drill-down**:
Navigation from a Collection Analytics tag ranking to the aggregate collection filtered by that Used Tag.
_Avoid_: Dashboard item browser

**Dashboard**:
The default app page that presents Collection Analytics without operational task progress or controls.
_Avoid_: Processing Dashboard, queue console

## Relationships

- The **Dashboard** presents **Collection Analytics**
- **Library Composition** is the primary **Collection Analytics** view
- **Collection Analytics** summarizes zero or more **Collection Items**
- A **Collection Item** belongs to exactly one supported platform
- A **Collection Item** has one **Creator** or bookmark **Domain**
- A **Collection Item** belongs to one or more **Sources** when the platform exposes containers
- A platform Collection page may present **Processing Coverage** for its locally persisted **Collection Items**
- The **Dashboard** does not present **Processing Coverage** or operational task progress
- **Library Composition** uses **Item Count** for platform share and **Membership Count** for Source rankings
- A **Tag Drill-down** leaves the **Dashboard** and opens matching **Collection Items** in the aggregate collection

## Example dialogue

> **Dev:** "Should the **Dashboard** show the current Embedding job and a pause button?"
> **Domain expert:** "No. The **Dashboard** summarizes stored **Collection Items**; task progress belongs elsewhere."

## Flagged ambiguities

- "Progress" may mean live task execution or idle **Processing Coverage**; platform Collection pages may combine them in one compact control, but the **Dashboard** contains neither.
- External platforms do not expose a durable remote-total snapshot, so **Processing Coverage** must not be described as remote sync completeness.
