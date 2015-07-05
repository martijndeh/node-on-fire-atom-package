/* global atom */
'use strict';

var Q = require('q');
var path = require('path');
var fs = require('fs');
var dotenv = require('dotenv-save');
var Commands = require('./commands');
var pg = require('pg');

function Firestarter() {
	var commands = new Commands();

	var _destroyMenu = null;
	var _env = {};
	var _isBuilding = false;
	var _isReleasing = false;
	var _isRunning = false;
	var _runProcess = null;

	var sanityCheck = function() {
		// On Mac, or other platforms (?), GUI apps like Atom have different environmental variables set.
		// This means we cannot spawn a node process through Atom if the PATH isn't set properly.
		// So let's do a sanity check if PATH is defined properly.

		return commands.nodeVersion().then(function() {
			return true;
		}).catch(function(error) {
			if(error && error.code == 'ENOENT') {
				atom.notifications.addError('Could not run `node -v`.', {
					detail: [
						'Do you have `node` installed or is your `PATH` configured properly for UI apps? This is different from console apps.',
						'',
						'Please have a look at http://apple.stackexchange.com/questions/51677/how-to-set-path-for-finder-launched-applications/51737#51737 and set up your PATH correctly for GUI apps.'].join('\n')
				});
			}
			else {
				atom.notifications.addError('Could not run `node -v`.', {
					detail: error.message
				});
			}
			return false;
		});
	};

	var build = function() {
		_isBuilding = true;
		createMenu();

		atom.notifications.addInfo('Building...');

		commands.build().then(function() {
			atom.notifications.addSuccess('Build succeeded.');
		}).catch(function(error) {
			atom.notifications.addError('Could not build.', {
				detail: error.message
			});
		}).finally(function() {
			_isBuilding = false;
			createMenu();
		}).done();
	};

	var release = function() {
		_isReleasing = true;
		createMenu();

		atom.notifications.addInfo('Releasing...');

		sanityCheck().then(function() {
			return commands.release();
		}).then(function() {
			atom.notifications.addSuccess('Release succeeded.');
		}).catch(function(error) {
			atom.notifications.addError('Could not release.', {
				detail: error.message
			});
		}).finally(function() {
			_isReleasing = false;
			createMenu();
		}).done();
	};

	var run = function() {
		_isRunning = true;
		createMenu();

		if(_runProcess) {
			console.log('Warning: start running but process still active.');
		}

		atom.notifications.addInfo('Starting...');

		sanityCheck().then(function() {
			return commands.run();
		}).then(function(runProcess) {
			_runProcess = runProcess;

			_runProcess.once('exit', function() {
				_runProcess = null;

				_isRunning = false;
				createMenu();
			});

			_runProcess.stdout.on('data', function(data) {
				console.log(data.toString());
			});

			_isRunning = true;
			createMenu();
		}).catch(function(error) {
			_isRunning = false;
			createMenu();

			atom.notifications.addError('Could not run.', {
				detail: error.message
			});
		}).done();
	};

	var stopRunning = function() {
		var defer = Q.defer();

		if(_runProcess) {
			_runProcess.once('exit', function() {
				defer.resolve();
			});
			_runProcess.kill('SIGINT');
		}
		else {
			defer.resolve();
		}

		return defer.promise;
	};

	var stop = function() {
		atom.notifications.addInfo('Stopping...');
		stopRunning().then(function() {
			atom.notifications.addSuccess('Successfully stopped.');
		}).done();
	};

	var restart = function() {
		atom.notifications.addInfo('Restarting...');

		stopRunning().then(function() {
			return run();
		}).done();
	};

	var isProject = function() {
		if(atom.project && atom.project.rootDirectories.length && atom.project.rootDirectories[0].path) {
			try {
				var packagePath = path.join(atom.project.rootDirectories[0].path, 'package.json');
				var packageJson = require(packagePath);
				return !!packageJson.dependencies.fire;
			}
			catch(e) {
				// We cannot open the package.json, so it doesn't exist.
			}
		}

		return false;
	};

	var buildRestart = function(event) {
		event.preventDefault();
		event.stopPropagation();

		atom.notifications.addInfo('Building...');

		commands.build().then(function() {
			atom.notifications.addInfo('Stopping...');

			return stopRunning();
		}).then(function() {
			atom.notifications.addInfo('Starting...');

			return run();
		}).done();
	};

	var destroyMenu = function() {
		if(_destroyMenu) {
			_destroyMenu.dispose();
			_destroyMenu = null;
		}
	};

	var createMigrations = function(fileNames, appName) {
		if(!_env.DATABASE_URL) {
			return Q.when([]);
		}
		else {
			return currentDatabaseVersion(appName, _env.DATABASE_URL.value).then(function(currentVersion) {
				return fileNames.map(function(a) {
					return a.match(/^([0-9]+)/)[1];
				}).sort(function(a, b) {
					return parseInt(b) - parseInt(a);
				}).map(function(fileName) {
					var command = 'fire:' + appName + ':release:migrate:' + fileName;
					var isRegistered = atom.commands.registeredCommands[command];
					var version = parseInt(fileName);

					if(!isRegistered) {
						atom.commands.add('atom-workspace', command, function() {
							atom.confirm({
								message: 'Do you want to migrate from version `' + currentVersion + '` to `' + version + '`?',
								detailedMessage: '',
								buttons: {
									Yes: function() {
										// TODO: Get current database version
										// TODO: Get current app name in env

										atom.notifications.addInfo('Migrating...');

										commands.migrate(appName, version).then(function() {
											atom.notifications.addSuccess('Migrated successfully to version `' + version + '`.');
										}).catch(function() {
											atom.notifications.addError('Failed to migrate to version `' + version + '`.');
										}).done();
									},
									No: function() {
										//
									}
								}
							});

						});
					}

					return {
						type: 'radio',
						groupId: 2,
						label: fileName,
						command: command,
						checked: (currentVersion === version)
					};
				});
			});
		}
	};

	var createEnv = function() {
		return dotenv.parse(fs.readFileSync(path.join(atom.project.rootDirectories[0].path, '.env')));
	};

	var currentDatabaseVersion = function(appName, databaseUrl) {
		var defer = Q.defer();

		pg.connect(databaseUrl, function(error, client, done) {
			if(error) {
				defer.reject(error);
			}
			else {
				// Using a different rowMode else Atom throws an error, because internally pg constructs a Function at runtime which breaks unsafe-eval mode.
				client.query({text: 'SELECT version FROM schemas ORDER BY version DESC LIMIT 1', rowMode: 'array'}, [], function(error2, result) {
					done();

					if(error2) {
						defer.reject(error2);
					}
					else {
						var version = result.rows[0][0] || 0;

						defer.resolve(version);
					}

					client.end();
				});
			}
		});

		return defer.promise;
	};

	var createMenu = function() {
		destroyMenu();

		_env = createEnv();

		var appNames = [];
		var migrations = [];

		var result = Q.when(true);

		var migrationsPath = path.join(atom.project.rootDirectories[0].path, '.fire', 'migrations');
		var fileNames = fs.readdirSync(migrationsPath);
		if(fileNames.length) {
			var isMigration = (fileNames[0].match(/^([0-9]+).*\.js$/) !== null);

			if(!isMigration) {
				appNames = fileNames;

				fileNames.forEach(function(appName) {
					result = result.then(function() {
						var migrationFileNames = fs.readdirSync(path.join(migrationsPath, appName));
						if(migrationFileNames.length) {
							return createMigrations(migrationFileNames, appName).then(function(submenu) {
								migrations.push({
									label: appName,
									submenu: submenu
								});
								return true;
							});
						}
					});
				}, this);
			}
			else {
				result = result.then(function() {
					return createMigrations(fileNames, 'default')
						.then(function(submenu) {
							migrations = submenu;
						});
				});
			}
		}

		result.then(function() {
			var menu = {
				label: 'Node on Fire',
				submenu: []
			};

			if(appNames.length) {
				appNames.forEach(function(appName) {
					var button = {
						groupId: 1,
						type: 'radio',
						label: appName
					};

					if(appName == _env.NODE_APP.value) {
						button.checked = true;
					}
					else {
						button.checked = false;
						button.selected = false;
					}

					menu.submenu.push(button);
				});

				menu.submenu.push({
					type: 'separator'
				});
			}

			if(_isBuilding) {
				menu.submenu.push({
					enabled: false,
					label: 'Building...'
				});
			}
			else {
				menu.submenu.push({
					label: 'Build',
					command: 'fire:build'
				});
			}

			if(_isReleasing) {
				menu.submenu.push({
					label: 'Releasing...',
					enabled: false
				});
			}
			else {
				menu.submenu.push({
					label: 'Release',
					command: 'fire:release'
				});
			}

			if(_isRunning) {
				menu.submenu.push({
					label: 'Stop',
					command: 'fire:run-stop'
				});

				menu.submenu.push({
					label: 'Restart',
					command: 'fire:restart'
				});

				menu.submenu.push({
					label: 'Build and Restart',
					command: 'fire:build-restart'
				});
			}
			else {
				menu.submenu.push({
					label: 'Run',
					sublabel: 'This is a sub.',
					command: 'fire:run'
				});
			}

			menu.submenu.push({
				type: 'separator'
			});

			menu.submenu.push({
				label: 'Migrations',
				submenu: migrations
			});

			_destroyMenu = atom.menu.add([menu]);
		}).done();
	};

	this.activate = function() {
		//atom.menu.template[9].submenu[1].checked = true;

		if(isProject()) {
			atom.commands.add('atom-workspace', 'fire:build', build.bind(this));
			atom.commands.add('atom-workspace', 'fire:release', release.bind(this));
			atom.commands.add('atom-workspace', 'fire:run', run.bind(this));
			atom.commands.add('atom-workspace', 'fire:run-stop', stop.bind(this));
			atom.commands.add('atom-workspace', 'fire:restart', restart.bind(this));
			atom.commands.add('atom-workspace', 'fire:build-restart', buildRestart.bind(this));

			createMenu();
		}
	};

	this.deactive = function(done) {
		destroyMenu();
		stopRunning().then(function() {
			done();
		}).done();
	};

	if(typeof atom.commands.registeredCommands == 'undefined') {
		throw new Error('`atom.commands.registeredCommands` is undefined. This is (was) a private API I\'m using to check if a command is already registered. I couldn\'t use `CommandManager#findCommands` because it doesn\'t simply expose if a command based on it\'s `commandName` is registered yet.');
	}
}

module.exports = new Firestarter();
