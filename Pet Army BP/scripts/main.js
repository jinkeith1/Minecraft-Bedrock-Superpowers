import { world, system } from "@minecraft/server";

// ============================================================
//  PET ARMY — Tame any mob and build your army!
// ============================================================

const MAX_PETS = 10;
const FOLLOW_DISTANCE = 12;
const TELEPORT_DISTANCE = 25;
const STOP_DISTANCE = 3;
const WAND_ID = "petarmy:taming_wand";
const TAMED_TAG = "petarmy:tamed";

// Mobs that cannot be tamed
const UNTAMEABLE = new Set([
  "minecraft:player",
  "minecraft:ender_dragon",
  "minecraft:wither",
  "minecraft:armor_stand",
  "minecraft:item",
  "minecraft:xp_orb",
  "minecraft:arrow",
  "minecraft:fireball",
  "minecraft:tnt",
  "minecraft:falling_block",
  "minecraft:experience_bottle",
]);

// ── Helpers ──────────────────────────────────────────────────

function ownerTag(playerName) {
  return `petarmy:owner_${playerName}`;
}

function getPetCount(playerName, dimension) {
  const pets = dimension.getEntities({
    tags: [TAMED_TAG, ownerTag(playerName)],
  });
  return pets.length;
}

function prettyName(typeId) {
  return typeId
    .replace("minecraft:", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getHeldItem(player) {
  const equip = player.getComponent("minecraft:equippable");
  if (!equip) return undefined;
  return equip.getEquipment("Mainhand");
}

// ── Taming (hit mob with wand) ──────────────────────────────

world.afterEvents.entityHitEntity.subscribe((event) => {
  const player = event.damagingEntity;
  const target = event.hitEntity;

  // Must be a player
  if (player.typeId !== "minecraft:player") return;

  // Must be holding the Taming Wand
  const held = getHeldItem(player);
  if (!held || held.typeId !== WAND_ID) return;

  // ── Untame (sneak + hit) ──
  if (player.isSneaking && target.hasTag(TAMED_TAG)) {
    if (target.hasTag(ownerTag(player.name))) {
      target.removeTag(TAMED_TAG);
      target.removeTag(ownerTag(player.name));
      target.nameTag = "";
      // Remove buffs
      try {
        target.removeEffect("health_boost");
        target.removeEffect("resistance");
        target.removeEffect("strength");
      } catch (_) {}
      player.sendMessage("§c✖ Released your pet back into the wild!");
      player.playSound("mob.cat.hiss");
    } else {
      player.sendMessage("§cThat's not your pet!");
    }
    return;
  }

  // ── Can't tame check ──
  if (UNTAMEABLE.has(target.typeId)) {
    player.sendMessage("§cYou can't tame that!");
    return;
  }

  // ── Already tamed check ──
  if (target.hasTag(TAMED_TAG)) {
    if (target.hasTag(ownerTag(player.name))) {
      player.sendMessage("§eAlready your pet! §7(Sneak + hit to release)");
    } else {
      player.sendMessage("§cThis pet belongs to someone else!");
    }
    return;
  }

  // ── Pet limit check ──
  const count = getPetCount(player.name, player.dimension);
  if (count >= MAX_PETS) {
    player.sendMessage(
      `§cPet army is full! (${MAX_PETS}/${MAX_PETS}) §7Sneak + hit a pet to release it.`
    );
    player.playSound("note.bass");
    return;
  }

  // ── Tame the mob! ──
  target.addTag(TAMED_TAG);
  target.addTag(ownerTag(player.name));

  const mobName = prettyName(target.typeId);
  target.nameTag = `§a⚔ §f${mobName} §a⚔\n§7${player.name}'s Pet`;

  // Buff the pet — tougher and stronger
  try {
    target.addEffect("health_boost", 20000000, {
      amplifier: 4,
      showParticles: false,
    });
    target.addEffect("resistance", 20000000, {
      amplifier: 1,
      showParticles: false,
    });
    target.addEffect("strength", 20000000, {
      amplifier: 1,
      showParticles: false,
    });
  } catch (_) {}

  // Heal to full
  const health = target.getComponent("minecraft:health");
  if (health) {
    health.setCurrentValue(health.effectiveMax);
  }

  // Celebration effects
  try {
    player.runCommand(
      `particle minecraft:totem_particle ${Math.floor(target.location.x)} ${Math.floor(target.location.y) + 1} ${Math.floor(target.location.z)}`
    );
  } catch (_) {}

  player.playSound("random.levelup");
  player.sendMessage(
    `§a✔ Tamed a §f${mobName}§a! §7(${count + 1}/${MAX_PETS} pets)`
  );
});

// ── Call All Pets (sneak + use wand on air) ──────────────────

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const item = event.itemStack;

  if (item.typeId !== WAND_ID) return;
  if (!player.isSneaking) return;

  const pets = player.dimension.getEntities({
    tags: [TAMED_TAG, ownerTag(player.name)],
  });

  if (pets.length === 0) {
    player.sendMessage("§7You don't have any pets yet! Hit a mob to tame it.");
    return;
  }

  const loc = player.location;
  let teleported = 0;

  for (const pet of pets) {
    try {
      const angle = (teleported / pets.length) * 2 * Math.PI;
      const offsetX = Math.cos(angle) * 2;
      const offsetZ = Math.sin(angle) * 2;
      pet.teleport(
        { x: loc.x + offsetX, y: loc.y, z: loc.z + offsetZ },
        { dimension: player.dimension }
      );
      teleported++;
    } catch (_) {}
  }

  player.sendMessage(`§a✔ Called ${teleported} pet(s) to your side!`);
  player.playSound("note.pling");
});

// ── Pet Follow AI (runs every 5 ticks) ──────────────────────

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const pets = player.dimension.getEntities({
      tags: [TAMED_TAG, ownerTag(player.name)],
    });

    const playerLoc = player.location;

    for (const pet of pets) {
      try {
        const petLoc = pet.location;
        const dx = playerLoc.x - petLoc.x;
        const dy = playerLoc.y - petLoc.y;
        const dz = playerLoc.z - petLoc.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Too far — teleport directly to player
        if (dist > TELEPORT_DISTANCE) {
          const angle = Math.random() * 2 * Math.PI;
          pet.teleport(
            {
              x: playerLoc.x + Math.cos(angle) * 2,
              y: playerLoc.y,
              z: playerLoc.z + Math.sin(angle) * 2,
            },
            { dimension: player.dimension }
          );
          continue;
        }

        // Close enough — stay put
        if (dist < STOP_DISTANCE) continue;

        // Follow — move toward player
        if (dist > STOP_DISTANCE && dist <= FOLLOW_DISTANCE) {
          const speed = 0.35;
          const nx = dx / dist;
          const nz = dz / dist;
          pet.applyKnockback(nx, nz, speed, dy > 1.5 ? 0.4 : 0);
        }

        // Medium range — sprint with speed boost
        if (dist > FOLLOW_DISTANCE && dist <= TELEPORT_DISTANCE) {
          try {
            pet.addEffect("speed", 30, {
              amplifier: 3,
              showParticles: false,
            });
          } catch (_) {}
          const speed = 0.6;
          const nx = dx / dist;
          const nz = dz / dist;
          pet.applyKnockback(nx, nz, speed, dy > 1.5 ? 0.5 : 0);
        }
      } catch (_) {
        // Pet may have died or despawned — clean up silently
      }
    }
  }
}, 5);

// ── Pet Defense (pets attack what hurts you) ─────────────────

world.afterEvents.entityHurt.subscribe((event) => {
  const hurt = event.hurtEntity;
  const attacker = event.damageSource.damagingEntity;

  // If a player got hurt, make their pets attack the attacker
  if (hurt.typeId === "minecraft:player" && attacker && attacker.typeId !== "minecraft:player") {
    const pets = hurt.dimension.getEntities({
      tags: [TAMED_TAG, ownerTag(hurt.name)],
    });

    for (const pet of pets) {
      try {
        const petLoc = pet.location;
        const atkLoc = attacker.location;
        const dx = atkLoc.x - petLoc.x;
        const dz = atkLoc.z - petLoc.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 20) {
          // Rush toward the attacker
          const nx = dx / dist;
          const nz = dz / dist;
          pet.applyKnockback(nx, nz, 0.8, 0.1);

          // If close enough, deal damage
          if (dist < 4) {
            try {
              attacker.applyDamage(6, {
                cause: "entityAttack",
                damagingEntity: pet,
              });
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
  }

  // If a pet got hurt by something that isn't its owner, retaliate
  if (
    hurt.hasTag(TAMED_TAG) &&
    attacker &&
    attacker.typeId !== "minecraft:player"
  ) {
    try {
      const loc = attacker.location;
      const petLoc = hurt.location;
      const dx = loc.x - petLoc.x;
      const dz = loc.z - petLoc.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0 && dist < 15) {
        hurt.applyKnockback(dx / dist, dz / dist, 0.6, 0.1);
        if (dist < 4) {
          try {
            attacker.applyDamage(6, {
              cause: "entityAttack",
              damagingEntity: hurt,
            });
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
});

// ── Give wand on first join ──────────────────────────────────

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;

  const player = event.player;

  system.runTimeout(() => {
    try {
      player.runCommand("give @s petarmy:taming_wand 1");
      player.sendMessage("§d§l★ Welcome to Pet Army! ★");
      player.sendMessage("§7You received a §dTaming Wand§7!");
      player.sendMessage("§7▸ §fHit any mob§7 to tame it");
      player.sendMessage("§7▸ §fSneak + hit§7 a pet to release it");
      player.sendMessage("§7▸ §fSneak + use wand§7 to call all pets");
      player.sendMessage(`§7▸ Max §f${MAX_PETS}§7 pets at a time`);
      player.sendMessage("§7▸ §fCraft more§7: Diamond + Blaze Rod + Gold Ingot");
      player.playSound("random.orb");
    } catch (_) {}
  }, 40);
});

// ── Periodic pet particle trail ──────────────────────────────

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const pets = player.dimension.getEntities({
      tags: [TAMED_TAG, ownerTag(player.name)],
    });
    for (const pet of pets) {
      try {
        const loc = pet.location;
        pet.runCommand(
          `particle minecraft:falling_dust_dragon_egg_particle ${loc.x} ${loc.y + 0.5} ${loc.z}`
        );
      } catch (_) {}
    }
  }
}, 20);

world.afterEvents.worldInitialize.subscribe(() => {
  console.warn("[Pet Army] Add-on loaded! Tame any mob with the Taming Wand!");
});
