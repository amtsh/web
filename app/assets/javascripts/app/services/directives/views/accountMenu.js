class AccountMenu {

  constructor() {
    this.restrict = "E";
    this.templateUrl = "frontend/directives/account-menu.html";
    this.scope = {};
  }

  controller($scope, authManager, modelManager, syncManager, $timeout) {
    'ngInject';

    $scope.formData = {url: syncManager.serverURL};
    $scope.user = authManager.user;
    $scope.server = syncManager.serverURL;

    $scope.syncStatus = syncManager.syncStatus;

    $scope.changePasswordPressed = function() {
      $scope.showNewPasswordForm = !$scope.showNewPasswordForm;
    }

    $scope.encryptionKey = function() {
      return syncManager.masterKey;
    }

    $scope.serverPassword = function() {
      return syncManager.serverPassword;
    }

    $scope.dashboardURL = function() {
      return `${$scope.server}/dashboard/?server=${$scope.server}&id=${$scope.user.email}&pw=${$scope.serverPassword()}`;
    }

    $scope.submitPasswordChange = function() {
      $scope.passwordChangeData.status = "Generating New Keys...";

      $timeout(function(){
        if(data.password != data.password_confirmation) {
          alert("Your new password does not match its confirmation.");
          return;
        }

        authManager.changePassword($scope.passwordChangeData.current_password, $scope.passwordChangeData.new_password, function(response){

        })

      })
    }

    $scope.loginSubmitPressed = function() {
      $scope.formData.status = "Generating Login Keys...";
      console.log("logging in with url", $scope.formData.url);
      $timeout(function(){
        authManager.login($scope.formData.url, $scope.formData.email, $scope.formData.user_password, function(response){
          if(!response || response.error) {
            $scope.formData.status = null;
            var error = response ? response.error : {message: "An unknown error occured."}
            if(!response || (response && !response.didDisplayAlert)) {
              alert(error.message);
            }
          } else {
            $scope.onAuthSuccess();
          }
        });
      })
    }

    $scope.submitRegistrationForm = function() {
      $scope.formData.status = "Generating Account Keys...";

      $timeout(function(){
        authManager.register($scope.formData.url, $scope.formData.email, $scope.formData.user_password, function(response){
          if(!response || response.error) {
            $scope.formData.status = null;
            var error = response ? response.error : {message: "An unknown error occured."}
            alert(error.message);
          } else {
            $scope.onAuthSuccess();
          }
        });
      })
    }

    $scope.onAuthSuccess = function() {
      syncManager.markAllItemsDirtyAndSaveOffline(function(){
        window.location.reload();
      })
    }

    $scope.destroyLocalData = function() {
      if(!confirm("Are you sure you want to end your session? This will delete all local items and extensions.")) {
        return;
      }

      syncManager.destroyLocalData(function(){
        window.location.reload();
      })
    }

    /* Import/Export */

    $scope.archiveFormData = {encrypted: $scope.user ? true : false};
    $scope.user = authManager.user;

    $scope.submitImportPassword = function() {
      $scope.performImport($scope.importData.data, $scope.importData.password);
    }

    $scope.performImport = function(data, password) {
      $scope.importData.loading = true;
      // allow loading indicator to come up with timeout
      $timeout(function(){
        $scope.importJSONData(data, password, function(response){
          $timeout(function(){
            $scope.importData.loading = false;
            $scope.importData = null;
            if(!response) {
              alert("There was an error importing your data. Please try again.");
            }
          })
        })
      })
    }

    $scope.importFileSelected = function(files) {
      $scope.importData = {};

      var file = files[0];
      var reader = new FileReader();
      reader.onload = function(e) {
        var data = JSON.parse(e.target.result);
        $timeout(function(){
          if(data.auth_params) {
            // request password
            $scope.importData.requestPassword = true;
            $scope.importData.data = data;
          } else {
            $scope.performImport(data, null);
          }
        })
      }

      reader.readAsText(file);
    }

    $scope.encryptionStatusForNotes = function() {
      var allNotes = modelManager.filteredNotes;
      return allNotes.length + "/" + allNotes.length + " notes encrypted";
    }

    $scope.importJSONData = function(data, password, callback) {
      console.log("Importing data", data);

      var onDataReady = function() {
        var items = modelManager.mapResponseItemsToLocalModels(data.items);
        items.forEach(function(item){
          item.setDirty(true);
          item.markAllReferencesDirty();
        })

        syncManager.sync(callback, {additionalFields: ["created_at", "updated_at"]});
      }.bind(this)

      if(data.auth_params) {
        Neeto.crypto.computeEncryptionKeysForUser(_.merge({password: password}, data.auth_params), function(keys){
          var mk = keys.mk;
          try {
            EncryptionHelper.decryptMultipleItems(data.items, mk, true);
            // delete items enc_item_key since the user's actually key will do the encrypting once its passed off
            data.items.forEach(function(item){
              item.enc_item_key = null;
              item.auth_hash = null;
            })
            onDataReady();
          }
          catch (e) {
            console.log("Error decrypting", e);
            alert("There was an error decrypting your items. Make sure the password you entered is correct and try again.");
            callback(null);
            return;
          }
        }.bind(this));
      } else {
        onDataReady();
      }
    }

    /*
    Export
    */

    function loadZip(callback) {
      if(window.zip) {
        callback();
        return;
      }

      var scriptTag = document.createElement('script');
      scriptTag.src = "/assets/zip/zip.js";
      scriptTag.async = false;
      var headTag = document.getElementsByTagName('head')[0];
      headTag.appendChild(scriptTag);
      scriptTag.onload = function() {
        zip.workerScriptsPath = "assets/zip/";
        callback();
      }
    }

    function downloadZippedNotes(notes) {
      loadZip(function(){

        zip.createWriter(new zip.BlobWriter("application/zip"), function(zipWriter) {

          var index = 0;
          function nextFile() {
            var note = notes[index];
            var blob = new Blob([note.text], {type: 'text/plain'});
            zipWriter.add(`${note.title}-${note.uuid}.txt`, new zip.BlobReader(blob), function() {
              index++;
              if(index < notes.length) {
                nextFile();
              } else {
                zipWriter.close(function(blob) {
                  downloadData(blob, `Notes Txt Archive - ${new Date()}.zip`)
        					zipWriter = null;
        				});
              }
            });
          }

          nextFile();
        }, onerror);
      })
    }

    var textFile = null;

    function hrefForData(data) {
      // If we are replacing a previously generated file we need to
      // manually revoke the object URL to avoid memory leaks.
      if (textFile !== null) {
        window.URL.revokeObjectURL(textFile);
      }

      textFile = window.URL.createObjectURL(data);

      // returns a URL you can use as a href
      return textFile;
    }

    function downloadData(data, fileName) {
      var link = document.createElement('a');
      link.setAttribute('download', fileName);
      link.href = hrefForData(data);
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    $scope.downloadDataArchive = function() {
      // download in Standard File format
      var ek = $scope.archiveFormData.encrypted ? syncManager.masterKey : null;
      var data = $scope.itemsData(ek);
      downloadData(data, `SN Archive - ${new Date()}.txt`);

      // download as zipped plain text files
      if(!ek) {
        var notes = modelManager.allItemsMatchingTypes(["Note"]);
        downloadZippedNotes(notes);
      }
    }

    $scope.itemsData = function(ek) {
      var items = _.map(modelManager.allItemsMatchingTypes(["Tag", "Note"]), function(item){
        var itemParams = new ItemParams(item, ek);
        return itemParams.paramsForExportFile();
      }.bind(this));

      var data = {items: items}

      if(ek) {
        // auth params are only needed when encrypted with a standard file key
        data["auth_params"] = authManager.getAuthParams();
      }

      var data = new Blob([JSON.stringify(data, null, 2 /* pretty print */)], {type: 'text/json'});
      return data;
    }

  }
}

angular.module('app.frontend').directive('accountMenu', () => new AccountMenu);
