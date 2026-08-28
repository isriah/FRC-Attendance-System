const applicationId = requireEnv("DISCORD_APPLICATION_ID");
const botToken = requireEnv("DISCORD_BOT_TOKEN");
const guildId = requireEnv("DISCORD_GUILD_ID");

const endpoint = `https://discord.com/api/v10/applications/${encodeURIComponent(applicationId)}/guilds/${encodeURIComponent(guildId)}/commands`;
const command = {
  name: "link-attendance",
  description: "Link your Discord account to your attendance member ID",
  dm_permission: false,
  options: [{
    type: 3,
    name: "member_id",
    description: "Your attendance member/student ID",
    required: true,
    min_length: 1,
    max_length: 64
  }]
};

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: `Bot ${botToken}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(command)
});

if (!response.ok) {
  const details = await response.text();
  throw new Error(`Discord command registration failed (${response.status}): ${details}`);
}

const registered = await response.json();
console.log(`Registered /${registered.name ?? command.name} for Discord guild ${guildId}.`);

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
