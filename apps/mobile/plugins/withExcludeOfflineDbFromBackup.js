// Plugin de config Expo local : exclut le fichier SQLite hors-ligne
// (apps/mobile/src/lib/offline/db.ts, "erp-offline.db") des sauvegardes
// iCloud/iTunes (iOS) et Auto Backup / Transfert d'appareil (Android), sans
// déplacer la base hors du stockage persistant — la file de mutations
// hors-ligne doit rester protégée d'une purge par l'OS en cas de stockage
// faible (docs/adr/0015-...).
//
// "use strict" volontairement omis : ce fichier est chargé par expo/config
// via require(), pas transpilé — voir expo-sqlite/plugin/build/withSQLite.js
// pour le même patron (CommonJS brut, pas de build step).
const { AndroidConfig, CodeGenerator, createRunOncePlugin, withAndroidManifest, withAppDelegate, withDangerousMod } =
  require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Cible le RÉPERTOIRE SQLite entier, pas le seul fichier erp-offline.db —
// une exclusion par fichier exact ne couvre pas ses annexes -journal/-wal/
// -shm (mode WAL non activé aujourd'hui par expo-sqlite, mais une exclusion
// par fichier serait silencieusement incomplète si ça change un jour ; revue
// sécurité Phase 9.4, docs/adr/0015-...). expo-sqlite stocke ses bases dans
// <Documents|filesDir>/SQLite/<name> par défaut (voir
// expo-sqlite/build/pathUtils.js, defaultDatabaseDirectory).
const SQLITE_DIR_NAME = "SQLite";

const BACKUP_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="file" path="${SQLITE_DIR_NAME}/" />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="file" path="${SQLITE_DIR_NAME}/" />
  </cloud-backup>
  <device-transfer>
    <exclude domain="file" path="${SQLITE_DIR_NAME}/" />
  </device-transfer>
</data-extraction-rules>
`;

// android:fullBackupContent (pré-Android 12) + android:dataExtractionRules
// (Android 12+) sont les deux mécanismes déclaratifs officiels d'exclusion
// sélective — préférés à android:allowBackup="false" qui coupe Auto Backup
// pour toute l'application, une granularité trop large pour un seul fichier.
function withAndroidBackupExclusion(config) {
  config = withDangerousMod(config, [
    "android",
    (config) => {
      const resXmlDir = path.join(config.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(resXmlDir, { recursive: true });
      fs.writeFileSync(path.join(resXmlDir, "backup_rules.xml"), BACKUP_RULES_XML);
      fs.writeFileSync(path.join(resXmlDir, "data_extraction_rules.xml"), DATA_EXTRACTION_RULES_XML);
      return config;
    },
  ]);

  return withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    mainApplication.$["android:fullBackupContent"] = "@xml/backup_rules";
    mainApplication.$["android:dataExtractionRules"] = "@xml/data_extraction_rules";
    return config;
  });
}

// NSURLIsExcludedFromBackupKey n'a pas d'équivalent Info.plist : c'est un
// attribut de ressource posé au runtime — posé sur le RÉPERTOIRE SQLite
// (pas le seul fichier .db, voir commentaire ci-dessus), ce qui exclut aussi
// son contenu (-journal/-wal/-shm compris) en une seule fois. Injecté via
// l'initialiseur d'une propriété stockée (pas "lazy" : s'exécute
// immédiatement à la création de l'instance AppDelegate, avant
// didFinishLaunchingWithOptions) plutôt que dans le corps d'une méthode
// existante — ancré uniquement sur la déclaration de classe, la ligne la
// plus stable du fichier généré à travers les versions du SDK Expo.
//
// Écart connu et documenté (docs/adr/0015-...) : au tout premier lancement,
// AppDelegate s'initialise avant que db.ts n'ait créé le répertoire SQLite —
// le test d'existence échoue silencieusement (try? + condition), l'exclusion
// prend effet au lancement suivant. Une sauvegarde ne se déclenche pas
// instantanément, ce délai est acceptable.
function withIosBackupExclusion(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") {
      throw new Error(
        "withExcludeOfflineDbFromBackup nécessite un AppDelegate Swift (généré par défaut depuis Expo SDK 53).",
      );
    }

    const snippet = `  private let erpExcludeOfflineDbFromBackupOnce: Void = {
    guard let documentsUrl = try? FileManager.default.url(
      for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false
    ) else { return }
    var url = documentsUrl.appendingPathComponent("${SQLITE_DIR_NAME}", isDirectory: true)
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else { return }
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }()`;

    const results = CodeGenerator.mergeContents({
      src: config.modResults.contents,
      newSrc: snippet,
      tag: "erp-exclude-offline-db-from-backup",
      anchor: /class AppDelegate\b.*\{/,
      offset: 1,
      comment: "//",
    });

    config.modResults.contents = results.contents;
    return config;
  });
}

const withExcludeOfflineDbFromBackup = (config) => {
  config = withAndroidBackupExclusion(config);
  config = withIosBackupExclusion(config);
  return config;
};

module.exports = createRunOncePlugin(withExcludeOfflineDbFromBackup, "withExcludeOfflineDbFromBackup", "1.0.0");
