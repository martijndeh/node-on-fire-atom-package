# Node on Fire Atom package

This package helps you with common tasks in Node on Fire-based projects. The package creates a menu item inside Node on Fire-based projects

- **Build**: builds your project.
- **Release**: generates all your tests and migrates your database.
- **Run**: runs `node index.js`. Currently this is not using foreman. When running, a **stop** and **restart** options are available.

### For Mac users
Please take a moment to read http://apple.stackexchange.com/questions/51677/how-to-set-path-for-finder-launched-applications/51737#51737 to set up your PATH inside Atom correctly. We're currently investigating on how to solve this issue.

### The future
In the future, this package will build your changes automatically once you change them.

### TODO
- Show all migrations and migrate to a specific database version.
- Automatically build whenever files get changed.
- Switch to a different datastore.
- Switch apps when there are multiple.
- git push to any of the remotes.
- Create new files e.g. migrations. Maybe in the context menu instead?
