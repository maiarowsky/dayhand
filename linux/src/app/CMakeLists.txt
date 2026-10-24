find_package(Qt6 6.8 REQUIRED COMPONENTS Gui Widgets Qml Quick QuickControls2 DBus Concurrent)

# The desktop app without main(), so the app tests can build the same windows.
add_library(dayhand_app STATIC
    AppModel.cpp
    Desktop.cpp
    Notifier.cpp
    PaletteFile.cpp
    ReminderClock.cpp
    SingleInstance.cpp
    Tray.cpp
)
target_include_directories(dayhand_app PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(dayhand_app PUBLIC
    dayhand_core
    Qt6::Gui Qt6::Widgets Qt6::Qml Qt6::Quick Qt6::QuickControls2 Qt6::DBus Qt6::Concurrent
)

# The windows. The QML reaches the app through the `app` and `desktop` context properties, so the module
# has no C++ types and needs no plugin.
qt_add_qml_module(dayhand_app
    URI Dayhand
    VERSION 1.0
    NO_PLUGIN
    OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/Dayhand
    QML_FILES
        qml/Main.qml
        qml/ConnectDialog.qml
        qml/QuickAddField.qml
        qml/QuickAddWindow.qml
        qml/SectionHeader.qml
        qml/SettingsDialog.qml
        qml/StatusLine.qml
        qml/TaskDetails.qml
        qml/TaskRow.qml
        qml/TodayList.qml
        qml/TrashList.qml
)

qt_add_resources(dayhand_app "dayhand_icons"
    PREFIX /icons
    BASE ${PROJECT_SOURCE_DIR}/data/icons
    FILES ${PROJECT_SOURCE_DIR}/data/icons/io.github.maiarowsky.dayhand.svg
)

qt_add_executable(dayhand-qt main.cpp)
target_link_libraries(dayhand-qt PRIVATE dayhand_app)
target_compile_definitions(dayhand-qt PRIVATE DAYHAND_VERSION="${PROJECT_VERSION}")

install(TARGETS dayhand-qt RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES ${PROJECT_SOURCE_DIR}/data/io.github.maiarowsky.dayhand.desktop
    DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)
install(FILES ${PROJECT_SOURCE_DIR}/data/io.github.maiarowsky.dayhand.metainfo.xml
    DESTINATION ${CMAKE_INSTALL_DATADIR}/metainfo)
install(FILES ${PROJECT_SOURCE_DIR}/data/icons/io.github.maiarowsky.dayhand.svg
    DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/scalable/apps)
