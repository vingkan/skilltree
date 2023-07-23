function getSkillsForRequirements(requirements) {
  const listTypes = {"and": true, "or": true, "some": true}
  if (requirements.type === "skill") {
    if (!requirements?.skillId) {
      return []
    }
    return [requirements.skillId]
  }

  if (requirements.type in listTypes) {
    const conditions = requirements?.conditions || []
    return (
      conditions
        .map(r => getSkillsForRequirements(r))
        .reduce((agg, val) => [...agg, ...val], [])
    )
  }

  return []
}

function transformToGraphData(results, positions) {
  const nodeIds = {}
  const nodes = []
  const edges = []

  // Extract nodes from the skills
  for (const skillId in results.skills) {
    if (!skillId) continue
    const skill = results.skills[skillId]
    const label = skill.title || skillId
    const satClass = skill.requirements.satisfied ? "Satisfied" : "Unsatisfied"
    const position = positions?.[skillId]
    nodes.push({
      data: {
        id: skillId,
        label
      },
      classes: satClass,
      position
    })
    nodeIds[skillId] = true
  }

  // Create edges based on skillId mentioned in the requirements for each skill
  for (const skillId in results.skills) {
    if (!(skillId in nodeIds)) {
      continue
    }

    const skill = results.skills[skillId]
    const requirements = skill.requirements
    const requiredSkills = (
      getSkillsForRequirements(requirements)
        .filter(skillId => skillId in nodeIds)
    )
    requiredSkills.forEach(requiredSkillId => {
      const dependencySatisfied = results.skills?.[requiredSkillId].requirements.satisfied
      const satClass = dependencySatisfied ? "Satisfied" : "Unsatisfied"
      edges.push({
        data: {
          source: requiredSkillId,
          target: skillId
        },
        classes: satClass
      })
    })
  }

  return { nodes, edges }
}

function hasCycle(graph) {
  const visited = new Set();
  const currentlyVisiting = new Set();

  function dfs(node) {
    if (visited.has(node)) return false;

    visited.add(node);
    currentlyVisiting.add(node);

    const neighbors = graph[node] || [];

    for (const neighbor of neighbors) {
      if (currentlyVisiting.has(neighbor) || dfs(neighbor)) {
        return true;
      }
    }

    currentlyVisiting.delete(node);
    return false;
  }

  for (const node in graph) {
    if (!visited.has(node) && dfs(node)) {
      return true;
    }
  }

  return false;
}

function toGraph(tree) {
  return Object.keys(tree.skills).reduce((agg, s) => {
    const skill = tree.skills[s]
    const edges = getSkillsForRequirements(skill.requirements || {})
    return {
      ...agg,
      [s]: edges
    }
  }, {})
}


function getAccumulatedPoints(skillId, progress, tree, totalReq) {
  const { maxDepth } = totalReq
  const req = tree?.skills?.[skillId]?.requirements || {}
  let details = []
  let visited = {}
  let queue = getSkillsForRequirements(req).map(s => ([s, 1]))
  while (queue.length > 0) {
    const [depId, depth] = queue.shift()
    if (depId in visited) continue
    if (maxDepth > 0 && depth > maxDepth) continue
    const dep = tree?.skills?.[depId]?.requirements || {}
    const dependencies = getSkillsForRequirements(dep).map(s => ([s, depth + 1]))
    queue = [...queue, ...dependencies]
    const invested = progress?.experience?.[depId] || 0
    details.push({ skillId: depId, invested })
    visited[depId] = true
  }
  return details
}

function evaluateRequirement(skillId, req, progress, results, tree) {
  if (req.type === "skill") {
    const satisfied = results?.[req.skillId]?.requirements?.satisfied || false
    return { ...req, satisfied }
  }
  if (req.type === "experience") {
    const required = req.required || 0
    const invested = progress?.experience?.[skillId] || 0
    const satisfied = invested >= required
    return { ...req, required, invested, satisfied }
  }
  if (req.type === "total_experience") {
    const required = req.required || 0
    const details = getAccumulatedPoints(skillId, progress, tree, req)
    const accumulated = details.reduce((a, v) => a + v.invested, 0)
    const satisfied = accumulated >= required
    return { ...req, required, details, accumulated, satisfied }
  }
  if (req.type === "and" || req.type === "or" || req.type === "some") {
    const conditions = req?.conditions?.map(r => evaluateRequirement(skillId, r, progress, results, tree)) || []
    let satisfied = false
    if (req.type === "and") {
      satisfied = conditions.every(c => c.satisfied) 
    }
    else if (req.type === "or") {
      satisfied = conditions.some(c => c.satisfied)
    }
    else if (req.type === "some") {
      const required = req.required || 0
      const completed = conditions.filter(c => c.satisfied).length
      satisfied = completed >= required
      return { ...req, conditions, required, completed, satisfied }
    }
    return { ...req, conditions, satisfied }
  }
  return { ...req, satisfied: false }
}

function evaluateAllSkills(tree, progress) {
  const allSkills = tree?.skills || {}
  let visitedSkills = {}
  let results = {}
  let queue = Array.from(Object.keys(tree.skills))
  let count = 0
  while (queue.length > 0) {
    const skillId = queue.shift()
    if (!(skillId in allSkills)) {
      visitedSkills[skillId] = true
      continue
    }
    if (skillId in visitedSkills) {
      continue
    }

    const skill = tree.skills?.[skillId]
    const requirements = skill?.requirements || {}
    const requiredSkills = getSkillsForRequirements(requirements).filter(s => !(s in visitedSkills))
    if (requiredSkills.length > 0) {
      queue = [...requiredSkills, skillId, ...queue]
      continue
    }
    
    const evaluated = evaluateRequirement(skillId, requirements, progress, results, tree)
    results[skillId] = { ...skill, requirements: evaluated }
    visitedSkills[skillId] = true
  }

  return { skills: results, progress }
}

function unSnakeCase(snake) {
  return (
    snake
      .split("_")
      .filter(s => s.length > 0)
      .map(s => s.at(0).toUpperCase() + s.slice(1))
      .join(" ")
  )
}

function configToRequirements(configs) {
  if (configs.length === 0) return {}
  const reqs = configs.map(c => {
    if ("exp" in c) {
      return { type: "experience", required: c.exp }
    }
    if ("total_exp" in c) {
      const maxDepth = c.max_depth || -1
      return { type: "total_experience", required: c.total_exp, maxDepth }
    }
    if ("skill" in c) {
      return { type: "skill", "skillId": c.skill }
    }
    if ("or" in c) {
      const andReq = configToRequirements(c.or || [])
      return { ...andReq, type: "or" }
    }
    if ("and" in c) {
      return configToRequirements(c.and || [])
    }
    if ("some" in c) {
      const andReq = configToRequirements(c.of || [])
      return { ...andReq, type: "some", required: c.required }
    }
    return {}
  })
  if (reqs.length === 1) {
    return reqs[0]
  }
  return {
    type: "and",
    conditions: reqs
  }
}

function configToTree(config) {
  const skills = config?.skills || []
  const updated = Object.keys(skills).map(skillId => {
    const skill = skills[skillId]
    const unSnaked = unSnakeCase(skillId)
    const { title, description } = skill
    const displayTitle = title || unSnaked
    const reqs = skill?.requires || []
    const requirements = configToRequirements(reqs)
    return { [skillId]: { title: displayTitle, description, requirements } }
  }).reduce((agg, val) => ({...agg, ...val}), {})
  return { skills: updated }
}
