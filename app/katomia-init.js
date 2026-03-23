

//see also todo_es_modules.md

const url = import.meta.url
const script = [...document.scripts].find(s => s.src === url)

const glogEnabled = script?.dataset?.glog === "on"

if(!glogEnabled || typeof window.glog !== "function"){
  if(!glogEnabled) console.log("GLog disabled via script tag")
  else console.log("GLog missing — installing noop logger")

  window.glog = window.glogStart = window.glogEnd = () => {}
}else{
  console.log("GLog active")
}
