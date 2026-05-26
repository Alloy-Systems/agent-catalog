# Resolve Project Root

Identify the target project root before any audit work begins.

Inputs:

- current working directory;
- user-provided path, if present;
- host workspace metadata, if available.

Output:

- `00-project-root.json`

If the root cannot be determined safely, ask the user for the absolute project folder path and stop.
