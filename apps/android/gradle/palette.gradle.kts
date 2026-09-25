// Generates Android palette constants/resources from the repo's single colour source
// (packages/shared/src/palette.json). Shared by every app module: set `extra["palettePackage"]`
// before applying, then add `extra["generatedPaletteDir"]`'s kotlin/ and res/ to the source sets.
import groovy.json.JsonSlurper

val palettePackage = extra["palettePackage"] as String
val paletteFile = rootProject.file("../../packages/shared/src/palette.json")
val generatedPaletteDir = layout.buildDirectory.dir("generated/palette")
extra["generatedPaletteDir"] = generatedPaletteDir

val generatePalette by tasks.registering {
    inputs.file(paletteFile)
    inputs.property("package", palettePackage)
    outputs.dir(generatedPaletteDir)
    doLast {
        @Suppress("UNCHECKED_CAST")
        val document = JsonSlurper().parse(paletteFile) as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val colors = document["colors"] as Map<String, String>
        fun pascal(name: String) = name.replaceFirstChar { it.uppercase() }
        fun snake(name: String) = name.replace(Regex("([a-z0-9])([A-Z])"), "$1_$2").lowercase()
        fun argb(value: String) = "FF" + value.removePrefix("#").uppercase()

        val kotlinDir = generatedPaletteDir.get().dir("kotlin/" + palettePackage.replace('.', '/')).asFile
        kotlinDir.mkdirs()
        kotlinDir.resolve("TalysmanPalette.kt").writeText(buildString {
            appendLine("// Generated from packages/shared/src/palette.json. Do not edit.")
            appendLine("package $palettePackage")
            appendLine()
            appendLine("import androidx.compose.ui.graphics.Color")
            appendLine()
            appendLine("object TalysmanPalette {")
            colors.forEach { (name, value) ->
                appendLine("    val ${pascal(name)} = Color(0x${argb(value)})")
            }
            appendLine("}")
        })

        val valuesDir = generatedPaletteDir.get().dir("res/values").asFile
        valuesDir.mkdirs()
        valuesDir.resolve("talysman_palette.xml").writeText(buildString {
            appendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>")
            appendLine("<!-- Generated from packages/shared/src/palette.json. Do not edit. -->")
            appendLine("<resources>")
            colors.forEach { (name, value) ->
                appendLine("    <color name=\"talysman_${snake(name)}\">$value</color>")
            }
            appendLine("</resources>")
        })
    }
}

tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(generatePalette) }
