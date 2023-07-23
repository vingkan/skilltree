const { useState, useEffect, useRef, Fragment } = React

function CytoscapeWrapper({
  elements,
  settings,
  defaultLayout,
  layout,
  positions,
  updateNodeId,
  updatePositions
}) {
  const ref = useRef()

  const hasLayout = Object.keys(layout).length > 0
  const hasPositions = Object.keys(positions).length > 0

  useEffect(() => {

    const cy = cytoscape({
      container: ref.current,
      elements,
      layout: defaultLayout,
      ...settings
    })

    if (!hasLayout) {
      cy.batch(() => {
        cy.nodes().forEach(node => {
          const nodeId = node.id()
          if (positions[nodeId]) {
            node.position(positions[nodeId])
          }
        })
      })
    }

    if (hasLayout) {
      try {
        cy.layout(layout).run()
      } catch (error) {}
    }

    cy.fit()

    cy.on("dragfree", "node", function(event) {
      const node = event.target
      let current = {...positions}
      current[node.id()] = node.position()
      if (!hasLayout) {
        updatePositions(current)
      }
    })

    cy.on("click", "node", function (event) {
      const node = event.target
      updateNodeId(node.id())
    })

    cy.on("tap", "node", function (event) {
      const node = event.target
      updateNodeId(node.id())
    })

    return () => cy.destroy()
  }, [elements, layout, defaultLayout, positions])

  return (
    <div ref={ref} className="Cytoscape"></div>
  )
}

function Visualizer(props) {
  return (
    <div className="Visualizer">
      <CytoscapeWrapper {...props} />
    </div>
  )
}

function ConfigEditor({ text, updateText, setEditor }) {
  const ref = useRef()

  useEffect(() => {
    const tabSize = 2
    const editor = new ace.edit(ref.current)
    setEditor(editor)
    editor.setTheme("ace/theme/monokai")
    editor.session.setMode("ace/mode/yaml")
    editor.session.setUseWrapMode(true);
    editor.session.setTabSize(tabSize)
    editor.setValue(text, -1)
    editor.session.on("change", () => {
      try {
        const yaml = editor.getValue()
        const config = jsyaml.load(yaml)
        const data = configToTree(config)
        if (hasCycle(toGraph(data))) {
          alert("Your skill tree is not allowed to have a cycle.")
          return
        }
        updateText(yaml)
      } catch (error) {
        return
      }
    })
  }, [])

  return (
    <div ref={ref} className="Editor"></div>
  )
}

function getItemTree(results, req, key) {
  if (req.type === "and" || req.type === "or" || req.type === "some") {
    const items = req.conditions.map((r, i) => (
      getItemTree(results, r, `${key}-${i}`))
    )
    if (req.type === "and") {
      return { ...req, key, items }
    }
    const verb = req.satisfied ? "Satisfied" : "Satisfy"
    const threshold = (
      req.type === "or"
        ? "at least one of"
        : `any ${req.required} of`
    )
    const title = `${verb} ${threshold}:`
    return { ...req, key, title, items }
  }
  if (req.type === "experience") {
    const exp = req.required
    const inv = req.invested
    const title = `Invested ${inv} / ${exp} EXP in this skill`
    return { ...req, key, title }
  }
  if (req.type === "total_experience") {
    const exp = req.required
    const acc = req.accumulated
    const title = `Invested ${acc} / ${exp} EXP in this tree`
    const notes = req.details.map((d, i) => {
      const name = results.skills?.[d.skillId]?.shortTitle || d.skillId
      const childKey = `${key}-note-${i}`
      const title = `${d.invested} from ${name}`
      const satisfied = results.skills?.[d.skillId]?.requirements?.satisfied || false
      return { key: childKey, title, satisfied }
    })
    return { ...req, key, title, notes }
  }
  if (req.type === "skill") {
    const skillId = req.skillId
    const skill = results.skills?.[skillId]?.shortTitle || skillId
    const verb = req.satisfied ? "Learned" : "Learn"
    const title = `${verb} ${skill}`
    return { ...req, key, title }
  }
  const title = "Unknown condition type"
  return { ...req, key, title }
}

function getTreeElements(item) {
  const { key, title, satisfied, items = [], notes = [] } = item
  const subItems = [...items, ...notes]
  const lis = subItems.map(v => getTreeElements(v))
  const satClass = satisfied ? "Satisfied" : "Unsatisfied"
  if (title) {
    const subList = subItems.length > 0 ? <ul>{lis}</ul> : null
    return <li key={key} className={satClass}>{title}{subList}</li>  
  }
  return (
    <Fragment key={key}>{lis}</Fragment>
  )
}

function getRequirementProgress(req) {
  let total = 1
  let done = 0
  if (req.type === "and") {
    total = req.conditions.length
    done = req.conditions.filter(c => c.satisfied).length
  }
  else if (req.satisfied) {
    done = 1
  }
  const plural = total === 1 ? "" : "s"
  return `Satisfied ${done} / ${total} condition${plural}:`
}

function Requirements({ results, node }) {
  const req = node?.requirements || {}
  const summary = getRequirementProgress(req)
  const items = getItemTree(results, req, 0)
  const els = getTreeElements(items)
  return (
    <div>
      <h3>Requirements</h3>
      <p>{summary}</p>
      <ul className="Conditions">{els}</ul>
    </div>
  )
}

function ExperienceEditor({ nodeId, value, setValue }) {
  const [points, setPoints] = useState(value)

  useEffect(() => {
    setPoints(value)
  }, [value])

  const editExperience = (e) => {
    const raw = e.target.value
    setPoints(raw)
    if (!raw) return
    const updated = parseInt(raw)
    setValue(updated)
  }

  return (
    <div className="ExperienceEditor">
      <h3>Experience Points</h3>
      <input type="number" value={points} onChange={editExperience} />
    </div>
  )
}

function Viewer({ results, nodeId, updateNodeId, setExperience }) {
  if (!nodeId) {
    return <p>Select a skill.</p>
  }

  const node = results.skills?.[nodeId] || {}
  const experience = results?.progress?.experience?.[nodeId] || 0
  const setPoints = (value) => setExperience(nodeId, value)
  const closeNode = () => updateNodeId("")

  return (
    <div className="Viewer Content">
      <span className="Closer" onClick={closeNode}>x</span>
      <h2>{node.shortTitle || nodeId}</h2>
      <p>{node.description}</p>
      <Requirements {...{results, node}} />
      <ExperienceEditor {...{nodeId, value: experience, setValue: setPoints}} />
    </div>
  )
}

const defaultLayout = {
  name: "breadthfirst",
  animate: false,
  nodeDimensionsIncludeLabels: true,
  avoidOverlap: true
}

const cytoscapeSettings = {
  style: [
    {
      selector: "node",
      style: {
        label: "data(label)",
        color: "white",
        "font-size": "12px",
        "font-family": "Metrophobic"
      }
    },
    {
      selector: "edge",
      style: {
        width: 3
      }
    },
    {
      selector: ".Unsatisfied",
      style: {
        "background-color": "#fc462d",
        "line-color": "#fc462d"
      }
    },
    {
      selector: ".Satisfied",
      style: {
        "background-color": "#ccfc2d",
        "line-color": "#ccfc2d"
      }
    }
  ]
}

const defaultConfig = `
title: Skill Tree Editor
skills:
  a:
    requires:
    - exp: 10
  b:
    requires:
    - exp: 10
  c:
    requires:
    - skill: a
    - skill: b
`.trim()

function App() {
  const storedConfig = localStorage.getItem("stored_config", "").trim()
  const initialConfig = storedConfig.length > 0 ? storedConfig : defaultConfig
  const [text, setText] = useState(initialConfig)

  const [editor, setEditor] = useState()

  const selectedNode = localStorage.getItem("selected_node", "")
  const [nodeId, setNodeId] = useState(selectedNode)

  const config = jsyaml.load(text)
  const tree = configToTree(config)
  const progress = config?.progress || {}
  const positions = config?.positions || {}
  const results = evaluateAllSkills(tree, progress)
  const elements = transformToGraphData(results)

  const title = config?.title || "(Untitled)"
  const settings = cytoscapeSettings
  const layout = config?.layout || {}

  const updateText = (text) => {
    localStorage.setItem("stored_config", text)
    setText(text)
  }

  const updateConfig = (newProgress, newPositions) => {
    const config = jsyaml.load(text)
    const jsonData = {
      ...config,
      progress: newProgress,
      positions: newPositions
    }
    const yamlData = jsyaml.dump(jsonData, {
      noArrayIndent: true
    })

    if (editor) {
      editor.setValue(yamlData, -1)
    }
  }

  const updateProgress = (newProgress) => {
    updateConfig(newProgress, positions)
  }

  const updatePositions = (newPositions) => {
    updateConfig(progress, newPositions)
  }

  const setExperience = (skillId, points) => {
    let experience = progress?.experience || {}
    experience[skillId] = points
    const updated = { ...progress, experience }
    updateProgress(updated)
  }

  const updateNodeId = (nodeId) => {
    localStorage.setItem("selected_node", nodeId)
    setNodeId(nodeId)
  }

  return (
    <div className="App">
      <div className="Content Title">
        <h1>{title}</h1>
      </div>
      <div className="Container">
        <div className="Column">
          <ConfigEditor {...{text, updateText, setEditor}} />
        </div>
        <div className="Column">
          <Viewer {...{results, nodeId, updateNodeId, setExperience}} />
          <Visualizer {...{
            elements,
            settings,
            defaultLayout,
            layout,
            positions,
            updateNodeId,
            updatePositions
          }}
          />
        </div>
      </div>
    </div>
  )
}

const container = document.getElementById("root")
const root = ReactDOM.createRoot(container)
const app = <App />
root.render(app);
