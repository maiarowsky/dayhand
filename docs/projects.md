# Projects

This page explains what a project is, how tasks get into one, and what colours, icons, the archive and
deletion do. Projects in the apps need Dayhand server 0.13.0 or later; the `dayhand project` commands, the
MCP project tools and the REST project routes need 0.13.1.

## What a project is

A **project** answers "what is this part of": a client, a website, the house. A task is in at most one
project, or in none. A project has a name, a colour, an emoji, a note and a place in a list you order; the
Android Projects tab and the Mac sidebar show it with its open and overdue counts. Projects are a flat
list: there are no sub-projects or areas.

Tasks have no labels or tags. Server 0.14.0 removed them, with the labels stored before: projects are
the one way to sort tasks. How the upgrade backs them up and removes them:
[Upgrading to 0.14.0](deploy.md#upgrading-to-0140). Apps and agents from before 0.14.0 may still send
labels; the server accepts them and ignores them.

## Where projects are

- **Android**: the **Projects** tab on the bottom bar, with each project's list and board, and a project
  picker in quick add, the task details and the task menus ([Android](android.md#projects)).
- **macOS**: the sidebar, with each project's list, board and week plan, **Move to Project…** (⇧⌘M) and
  drag and drop ([macOS](macos-app.md#the-window)).
- **The command line**: `dayhand project` and `-p, --project` on `today`, `add`, `list`, `board` and
  `edit`; `+project` in the quick add of `dayhand ui` ([command reference](cli.md#dayhand-project)).
- **Agents**: the MCP tools `list_projects`, `add_project` and `update_project`, and `projectId` on the
  task tools; only the owner deletes a project ([MCP](mcp.md#projects)). The same over the
  [REST API](api.md#projects).
- **Linux**: the Linux app does not show projects yet. A task you edit there keeps its project.

## Names, colours and icons

- **Name**: 1 to 50 characters on one line, unique whatever the case, archived projects included. `none`
  is reserved: in filters and pickers it means "without a project".
- **Colour**: one of twelve, `red`, `orange`, `amber`, `green`, `teal`, `cyan`, `blue`, `indigo`,
  `purple`, `pink`, `brown` or `gray`, or none. The server stores the name of the colour, and each app
  draws it in a shade that stands out from its own background ([design](design.md#project-colours)).
  The project's name is always written next to its colour, so nothing depends on colour alone.
- **Icon**: one emoji, shown with the project's mark.
- **Note**: up to 2,000 characters on what the project is about. Your agents read it with the project
  list, so a line such as "The new site for Anna's bakery; launch on 1 December" helps them file tasks.
- **Order**: you choose it. Drag projects in the Mac sidebar, use **Set order** on Android, or
  `dayhand project edit Home --first` (also `--before`, `--after` and `--last`).

You can have up to 200 projects, archived ones included.

## Putting tasks in a project

- **Quick add**: `+Bakery-website` anywhere in the line, on Android, on the Mac and in `dayhand ui`. It
  must name a project that exists and is not archived, in any case, with hyphens for spaces. A name that
  matches nothing stays in the title and the preview says so; quick add never creates a project.
- **The apps**: the project picker on Android; **Move to Project…** or dragging a task onto a project in
  the sidebar on the Mac. Quick add at the top of a project's list adds to that project.
- **The command line**: `dayhand add "Order business cards" -p "Bakery website"`,
  `dayhand edit 42 -p none`, or several tasks at once with `dayhand project assign Home 41 42 -y`.
- The next date of a repeating task stays in the same project.

Putting a task into a project the server already has works offline, like any other change to a task.

## Archive and delete

**Archive** a project that is finished or on hold. It leaves the main list and the pickers and takes no
new tasks, but its tasks stay where they were: in Today, the calendar and the board, with the project's
mark. Android offers to archive the project's open tasks too. Archived projects wait under **Archived**,
and `dayhand project unarchive` or **Restore** brings one back.

**Delete** is for the owner only: the apps and `dayhand` with your own key can, an agent cannot. No task
is ever deleted with its project. When any task points at the project, including done, archived and
trashed tasks and proposals, you choose where they go: another project or none.

```sh
dayhand project rm "Old blog" --move-tasks-to none
```

One deletion moves at most 1,000 tasks; move the rest first.

## Managing projects needs your server

Creating, editing, ordering, archiving and deleting projects happen on the server at once, in every
app. Offline, or on a phone or Mac without a server, the app says **Requires a
connection to the server** and changes nothing. Changes to tasks still work offline and are sent later.

Android's sample plan has three projects of its own (Home, Work and Health) to look around with; they
never leave the phone.

## Backlog.md and imports

- **Backlog.md**: a Backlog.md folder is one repository, so it maps to one project.
  `dayhand backlog import backlog --project "Bakery website"` puts the new tasks in that project and
  creates it if it is missing. Importing the folder again brings only new files, and tasks imported before
  stay where they are. `dayhand backlog export backlog --project "Bakery website"` writes only that
  project, with its name as the project name in `config.yml`. A folder's own project name never picks or
  creates a project. More: [Backlog.md import and export](backlog-md.md#using-it).
- **Other files**: `dayhand import <file> --project <name>` sends the tasks the file leaves without a
  project to a project that exists ([dayhand import](cli.md#dayhand-import)). Dayhand's own JSON export
  carries the projects with their colours, icons, notes and archive state, and importing it reuses a
  project of the same name or creates it ([REST import](api.md#import)).
- **Exports**: the Markdown export writes `+Project-name` after a task's title. The calendar feed has no
  projects.

## What projects do not do yet

- **No project events.** Creating, renaming, recolouring or deleting a project is not in the activity log
  (`dayhand log`, `list_events`) and sends no webhook. A task moved to another project is: it gets a
  `task.updated` event.
- **No ETag for projects** over REST: when two clients change one project, the last write wins.
- **No sub-projects or areas.**
- **The Linux app** does not show projects.
- **Versions**: projects in the apps need server 0.13.0 or later, and the `dayhand project` commands, the
  MCP project tools and the REST project routes need 0.13.1; Android 0.12.0 needs server 0.13.2.
