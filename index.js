const parse = require('csv-parse/lib/sync');
const process = require('process');
const fs = require('fs');
const prompts = require('prompts');
const KcAdminClient = require('keycloak-admin').default;
const { program } = require('commander');

const _connectKeycloakClient = async ({ keycloakClientId, keycloakUrl, keycloakRealm }) => {
  // Connect to KeyCloak
  let keycloakClientSecret = process.env.KEYCLOAK_SECRET;
  if(!keycloakClientSecret) {
    const response = await prompts({
      type: 'password',
      name: 'keycloakClientSecret',
      message: `Confidential client secret for ${keycloakClientId}`,
    });
    keycloakClientSecret = response.keycloakClientSecret;
  }
  const keycloakClient = new KcAdminClient({
    baseUrl: keycloakUrl,
    realmName: keycloakRealm
  });
  await keycloakClient.auth({
    grantType: 'client_credentials',
    clientId: keycloakClientId,
    clientSecret: keycloakClientSecret,
  });
  return keycloakClient;
};

const csvRecordToKeycloakUserRepresentation = ({Name, Rank, Callsign, Position, Location, email}) => ({
  enabled: true,
  emailVerified: true,
  email,
  username: email,
  firstName: Name.split(' ')?.[0],
  lastName: Name.split(' ')?.[1],
  attributes: {
    EDIPI: email,
    location: Location,
    gcasRank: Rank,
    gcasCallsign: Callsign,
    gcasPosition: Position,
  }
});

const csvRecordToResetPasswordPayload = ({id, password}) => ({
  id: id,
  credential: {
    temporary: false,
    type: 'password',
    value: password,
  }
})

program.version('1.0.0');
program
  .description('Keycloak Utilities');

program
  .command('convert <path_to_csv> <keycloak_url>')
  .description('Read a CSV full of user information. Use keycloak-admin to create those users on a keycloak instance.')
  .option('-c, --keycloak-client-id <clientId>', 'confidential clientId providing KeyCloak "manage-users" rights.', process.env.KEYCLOAK_APP || 'gate_api')
  .option('-r, --keycloak-realm <realm>', 'KeyCloak realm name.', process.env.KEYCLOAK_REALM || 'emssa')
  .action(async (pathToCsv, keycloakUrl, { keycloakClientId, keycloakRealm }) => {
    console.log(`Reading ${pathToCsv}...`)
    // Read CSV
    let records = parse(fs.readFileSync(pathToCsv), {
      columns: true,
      skip_empty_lines: true,
    });
    
    console.log(`Connecting to ${keycloakUrl}`);
    const keycloakClient = await _connectKeycloakClient({
      keycloakClientId,
      keycloakUrl,
      keycloakRealm,
    });

    const userRepresentations = records.map(csvRecordToKeycloakUserRepresentation);

    console.log(`Creating ${records.length} users...`);

    // Loop through and post KeyCloak users
    for (let i = 0; i < userRepresentations.length; i++) {
      const entry = userRepresentations[i];
      const response = await keycloakClient.users.create(entry);
      records[i] = {...records[i], id: response.id};
    }

    console.log("Setting user passwords...");

    // Set user passwords
    for (const resetPasswordPayload of records.map(csvRecordToResetPasswordPayload)) {
      await keycloakClient.users.resetPassword(resetPasswordPayload);
    }

    console.log("Done.");
  });

program
  .command('flushUsers <keycloak_url>')
  .description('Delete all users from the KeyCloak realm. WARNING: Highly destructive command, cannot be undone.')
  .option('-c, --keycloak-client-id <clientId>', 'confidential clientId providing KeyCloak "manage-users" rights.', process.env.KEYCLOAK_APP || 'gate_api')
  .option('-r, --keycloak-realm <realm>', 'KeyCloak realm name.', process.env.KEYCLOAK_REALM || 'emssa')
  .action(async (keycloakUrl, { keycloakClientId, keycloakRealm }) => {
    const keycloakClient = await _connectKeycloakClient({
      keycloakClientId,
      keycloakUrl,
      keycloakRealm,
    });

    const users = await keycloakClient.users.find();

    const uids = users.map((d) => d.id);

    console.log(`Deleting ${users.length} users...`);

    for(const uid of uids) {
      await keycloakClient.users.del({
        id: uid,
      });
    };

    console.log('Done.');
  });
program.parseAsync(process.argv);
