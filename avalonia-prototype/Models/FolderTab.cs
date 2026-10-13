using CommunityToolkit.Mvvm.ComponentModel;

namespace FileManagerLab.Models;

public partial class FolderTab(string name, bool isPinned) : ObservableObject
{
    public string Name { get; } = name;

    [ObservableProperty]
    private bool _isPinned = isPinned;
}
