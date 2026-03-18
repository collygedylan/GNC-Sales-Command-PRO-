// Corrected handleLogin function
async function handleLogin() {
    try {
        const { user, error } = await supabase.auth.signIn({
            email: emailInput.value,
            password: passwordInput.value
        });
        if (error) throw error;
        // Handle successful login (e.g., redirect to dashboard)
    } catch (err) {
        console.error('Login failed:', err.message);
        // Display error to user (e.g., show error message in UI)
    }
}