using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FileManagerLab.Models;

namespace FileManagerLab.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    public ObservableCollection<FolderTab> Tabs { get; } = new();
    public ObservableCollection<FileItem> Files { get; } = new();

    [ObservableProperty]
    private FolderTab? _activeTab;

    [ObservableProperty]
    private string _activeFolder = "Pictures / Autumn collection";

    [ObservableProperty]
    private string _statusMessage = "Ready — 1,000 entries are virtualized, not all rendered at once.";

    [ObservableProperty]
    private bool _showGrid = true;

    [ObservableProperty]
    private int _selectedFileCount;

    public MainViewModel()
    {
        string[] folders = ["Home", "Pictures / Autumn collection", "Downloads", "Projects", "Archive", "Screenshots", "Music", "Documents", "Desktop", "Samples"];
        for (var index = 0; index < folders.Length; index++)
        {
            Tabs.Add(new FolderTab(folders[index], index is 0 or 1));
        }

        ActiveTab = Tabs[1];
        LoadDemoFiles();
    }

    partial void OnActiveTabChanged(FolderTab? value)
    {
        if (value is null) return;
        ActiveFolder = value.Name;
        StatusMessage = $"Switched to {value.Name}. 1,000 items remain available for scroll testing.";
    }

    [RelayCommand]
    private void AddTab()
    {
        var tab = new FolderTab($"Test folder {Tabs.Count + 1}", false);
        Tabs.Add(tab);
        ActiveTab = tab;
    }

    [RelayCommand]
    private void ActivateTab(FolderTab? tab)
    {
        if (tab is not null) ActiveTab = tab;
    }

    [RelayCommand]
    private void PinTab(FolderTab? tab)
    {
        if (tab is null) return;
        tab.IsPinned = !tab.IsPinned;
        StatusMessage = tab.IsPinned ? $"Pinned {tab.Name}." : $"Unpinned {tab.Name}.";
    }

    [RelayCommand]
    private void OpenTerminal()
    {
        try
        {
            Process.Start(new ProcessStartInfo("wt.exe", "-d \"D:\\Code-Rebuild\"") { UseShellExecute = true });
            StatusMessage = "Opened Windows Terminal at D:\\Code-Rebuild.";
        }
        catch (Exception)
        {
            StatusMessage = "Windows Terminal could not be started on this machine.";
        }
    }

    [RelayCommand]
    private void ToggleLayout()
    {
        ShowGrid = !ShowGrid;
        StatusMessage = ShowGrid ? "Grid view enabled." : "Compact list view enabled.";
    }

    private void LoadDemoFiles()
    {
        string[] extensions = ["JPG", "PNG", "WEBP", "HEIC"];
        string[] accents = ["#A78BFA", "#38BDF8", "#34D399", "#FBBF24", "#FB7185", "#FB923C"];
        for (var index = 1; index <= 1000; index++)
        {
            var extension = extensions[index % extensions.Length];
            Files.Add(new FileItem(
                $"Autumn-frame-{index:0000}.{extension.ToLowerInvariant()}",
                extension,
                $"{1 + index % 24}.{index % 10} MB",
                accents[index % accents.Length],
                index % 11 == 0));
        }
    }
}
