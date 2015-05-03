var spawn = require('child_process').spawn;
var Q = require('q');
var path = require('path');

function Firestarter() {
	this._destroyMenu = null;
}

Firestarter.prototype.runCommand = function(command, args) {
	var buildProcess = spawn(command, args, {
		cwd: atom.project.rootDirectories[0].path
	});

	// TODO: Remove the colors

	return buildProcess;
};

Firestarter.prototype.runTask = function(command, args) {
	var defer = Q.defer();

	var buildProcess = this.runCommand(command, args);

	var allData = null;
	buildProcess.stdout.on('data', function(data) {
		if(!allData) {
			allData = data;
		}
		else {
			// Wait till converting the buffer to a string. This is faster.
			allData = Buffer.concat([allData, data]);
		}
	});

	buildProcess.on('exit', function(error, stdout, stderr) {
		if(error) {
			defer.reject({
				code: error,
				message: allData && allData.toString()
			});
		}
		else {
			// Converting to a string now is faster.
			defer.resolve(allData && allData.toString());
		}
	});

	buildProcess.on('error', function(error) {
		defer.reject(error);
	});

	return defer.promise;
};

Firestarter.prototype.sanityCheck = function() {
	// On Mac, or other platforms (?), GUI apps like Atom have different environmental variables set.
	// This means we cannot spawn a node process through Atom if the PATH isn't set properly.
	// So let's do a sanity check if PATH is defined properly.

	return this.runTask('node', ['-v']).then(function(version) {
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

Firestarter.prototype.build = function() {
	var self = this;

	this._isBuilding = true;
	this.createMenu();

	atom.notifications.addInfo('Building...');

	this.sanityCheck().then(function() {
		return self.runTask('grunt', ['build']);
	}).then(function() {
		atom.notifications.addSuccess('Build succeeded.');
	}).catch(function(error) {
		atom.notifications.addError('Could not build.', {
			detail: error.message
		});
	}).finally(function() {
		self._isBuilding = false;
		self.createMenu();
	}).done();
};

Firestarter.prototype.release = function() {
	var self = this;

	this._isReleasing = true;
	this.createMenu();

	atom.notifications.addInfo('Releasing...');

	this.sanityCheck().then(function() {
		return self.runTask('grunt', ['release']);
	}).then(function() {
		atom.notifications.addSuccess('Release succeeded.');
	}).catch(function(error) {
		atom.notifications.addError('Could not release.', {
			detail: error.message
		});
	}).finally(function() {
		self._isReleasing = false;
		self.createMenu();
	}).done();
};

Firestarter.prototype.run = function() {
	var self = this;

	this._isRunning = true;
	this.createMenu();

	atom.notifications.addInfo('Starting...');

	this.sanityCheck().then(function() {
		return self.runCommand('node', ['index.js']);
	}).then(function(runProcess) {
		self._runProcess = runProcess;

		self._runProcess.once('exit', function() {
			self._runProcess = null;

			self._isRunning = false;
			self.createMenu();
		});

		self._runProcess.stdout.on('data', function(data) {
			console.log(data.toString());
		});
	}).catch(function(error) {
		self._isRunning = false;
		self.createMenu();

		atom.notifications.addError('Could not run.', {
			detail: error.message
		});
	}).done();
};

Firestarter.prototype.stopRunning = function() {
	var defer = Q.defer();
	var self = this;

	this._runProcess.once('exit', function() {
		defer.resolve();
	});
	this._runProcess.kill('SIGINT');
	return defer.promise;
};

Firestarter.prototype.stop = function() {
	atom.notifications.addInfo('Stopping...');
	this.stopRunning().then(function() {
		atom.notifications.addSuccess('Successfully stopped.');
	}).done();
};

Firestarter.prototype.restart = function() {
	atom.notifications.addInfo('Restarting...');
	var self = this;
	this.stopRunning().then(function() {
		self.run();
	}).done();
};

Firestarter.prototype.isProject = function() {
	if(atom.project && atom.project.rootDirectories.length && atom.project.rootDirectories[0].path) {
		var packageJson = require(path.join(atom.project.rootDirectories[0].path, 'package.json'));
		return !!packageJson.dependencies.fire;
	}

	return false;
};

Firestarter.prototype.activate = function() {
	if(this.isProject()) {
		console.log(process.env);

		atom.commands.add('atom-workspace', 'fire:build', this.build.bind(this));
		atom.commands.add('atom-workspace', 'fire:release', this.release.bind(this));
		atom.commands.add('atom-workspace', 'fire:run', this.run.bind(this));
		atom.commands.add('atom-workspace', 'fire:run-stop', this.stop.bind(this));
		atom.commands.add('atom-workspace', 'fire:restart', this.restart.bind(this));

		this.createMenu();
	}
};

Firestarter.prototype.destroyMenu = function() {
	if(this._destroyMenu) {
		this._destroyMenu.dispose();
		this._destroyMenu = null;
	}
};

Firestarter.prototype.createMenu = function() {
	this.destroyMenu();

	var menu = {
		label: 'Node on Fire',
		submenu: []
	};

	if(this._isBuilding) {
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

	if(this._isReleasing) {
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

	if(this._isRunning) {
		menu.submenu.push({
			label: 'Stop',
			command: 'fire:run-stop'
		});

		menu.submenu.push({
			label: 'Restart',
			command: 'fire:restart'
		});
	}
	else {
		menu.submenu.push({
			label: 'Run',
			command: 'fire:run'
		});
	}

	this._destroyMenu = atom.menu.add([menu]);
};

Firestarter.prototype.deactive = function(done) {
	this.destroyMenu();
	return this.stopRunning().then(function() {
		done();
	});
};

var firestarter = new Firestarter();

module.exports = {
	activate: firestarter.activate.bind(firestarter),
	deactive: firestarter.deactive.bind(firestarter)
};
